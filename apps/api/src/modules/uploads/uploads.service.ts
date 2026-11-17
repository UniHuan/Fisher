import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import sharp from 'sharp';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import type { UploadImageDto, UploadPurpose } from './dto/upload-image.dto';
import type { UploadImageResponseDto } from './dto/upload-image-response.dto';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TARGET_BYTES: Record<UploadPurpose, number> = {
  cover: 200 * 1024,
  detail: 300 * 1024,
};
const MAX_DIMENSION = 1600;
const QUALITIES = [82, 75, 68, 60] as const;

export interface UploadedImageFile {
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
  originalname?: string;
}

type SupportedImage = 'jpeg' | 'png' | 'webp';

function detectImageType(buffer: Buffer): SupportedImage | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async upload(
    input: UploadImageDto,
    file: UploadedImageFile | undefined,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<UploadImageResponseDto> {
    const spot = await this.prisma.spot.findFirst({
      where: { spot_id: input.spot_id, deleted_at: null },
      select: { spot_id: true },
    });
    if (spot === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot not found');
    }

    if (file === undefined || file.buffer === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Image file is required');
    }
    const originalSize = file.size ?? file.buffer.length;
    if (originalSize > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Image exceeds 10 MB',
      );
    }
    if (detectImageType(file.buffer) === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Only JPG, PNG and WebP images are accepted',
      );
    }

    const processed = await this.processImage(file.buffer, input.purpose);
    const key = `spots/${spot.spot_id}/${ulid()}.webp`;
    try {
      await this.storage.putObject(key, processed.data, 'image/webp');
    } catch {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Image storage unavailable',
      );
    }

    const previewUrl = await this.storage.getPreviewUrl(key);
    const result: UploadImageResponseDto = {
      key,
      preview_url: previewUrl,
      expires_at: new Date(Date.now() + PREVIEW_URL_TTL_SECONDS * 1000).toISOString(),
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
      purpose: input.purpose,
    };
    await this.recordAudit(admin, request, spot.spot_id, result);
    return result;
  }

  private async processImage(
    buffer: Buffer,
    purpose: UploadPurpose,
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const target = TARGET_BYTES[purpose];
    try {
      for (const quality of QUALITIES) {
        const result = await sharp(buffer, {
          failOn: 'error',
          limitInputPixels: 40_000_000,
        })
          .rotate()
          .resize({
            width: MAX_DIMENSION,
            height: MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality })
          .toBuffer({ resolveWithObject: true });
        if (result.data.length <= target) {
          return {
            data: result.data,
            width: result.info.width,
            height: result.info.height,
          };
        }
      }
    } catch {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Image could not be processed',
      );
    }
    throw new AppError(
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'Image is still too large after compression',
    );
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    spotId: string,
    result: UploadImageResponseDto,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action: 'spot.image_upload',
      entityType: 'spot',
      entityId: spotId,
      before: null,
      after: {
        key: result.key,
        purpose: result.purpose,
        width: result.width,
        height: result.height,
        size_bytes: result.size_bytes,
      },
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
