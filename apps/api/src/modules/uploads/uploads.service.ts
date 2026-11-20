import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import type { UploadImageDto } from './dto/upload-image.dto';
import type { UploadImageResponseDto } from './dto/upload-image-response.dto';
import {
  ImageProcessorService,
  type UploadedImageFile,
} from './image-processor.service';
import { PreviewSignerService } from './preview-signer.service';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditLogs: AuditLogService,
    private readonly images: ImageProcessorService,
    private readonly previewSigner: PreviewSignerService,
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
    this.images.validateUpload(file.buffer, file.size);

    const processed = await this.images.process(file.buffer, input.purpose);
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

    const preview = this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS);
    const result: UploadImageResponseDto = {
      key,
      preview_url: preview.url,
      expires_at: preview.expiresAt,
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
      purpose: input.purpose,
    };
    await this.recordAudit(admin, request, spot.spot_id, result);
    return result;
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
