import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, UGC_UPLOAD_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import type { UploadUgcResponseDto } from './dto/upload-ugc-response.dto';
import { ImageProcessorService, type UploadedImageFile } from './image-processor.service';

const DAILY_UPLOAD_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayBounds(now: Date): { start: Date; end: Date } {
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/**
 * C-end image upload. The `ugc_upload` row is written before the object so a
 * failed object write can always be tracked and marked deleted.
 *
 * The 30/day quota is counted from the user's `ugc_upload` rows for the current
 * UTC day (including rows later marked deleted, since this is an anti-abuse
 * control over attempts). A per-user advisory transaction lock serializes the
 * count and insert across API instances, so two requests cannot both pass at 30.
 */
@Injectable()
export class UploadsUgcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessorService,
    private readonly clientConfig: ClientConfigService,
  ) {}

  async upload(
    file: UploadedImageFile | undefined,
    appUser: AppUserContext | undefined,
  ): Promise<UploadUgcResponseDto> {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    await this.assertUgcEnabled();
    if (file === undefined || file.buffer === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Image file is required');
    }
    this.images.validateUpload(file.buffer, file.size);

    const now = new Date();
    const processed = await this.images.process(file.buffer, 'ugc');
    const uploadId = ulid();
    const key = `ugc/${appUser.userId}/${uploadId}.webp`;
    await this.reserveUploadSlot(appUser.userId, uploadId, key, processed.data.length, now);

    try {
      await this.storage.putObject(key, processed.data, 'image/webp');
    } catch {
      // Keep an audit trace instead of leaving an object without a row.
      await this.prisma.ugcUpload.updateMany({
        where: { upload_id: uploadId, status: UGC_UPLOAD_STATUS.PENDING },
        data: { status: UGC_UPLOAD_STATUS.DELETED, deleted_at: new Date() },
      });
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Image storage unavailable',
      );
    }

    return {
      key,
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
    };
  }

  private async reserveUploadSlot(
    userId: string,
    uploadId: string,
    objectKey: string,
    sizeBytes: number,
    now: Date,
  ): Promise<void> {
    const { start, end } = utcDayBounds(now);
    await this.prisma.$transaction(async (tx) => {
      // Serialize per-user quota checks; the lock is released with the transaction.
      // Cast the `void` result to text so Prisma can deserialize the row.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ugc-upload:${userId}`}))::text`;
      const used = await tx.ugcUpload.count({
        where: { user_id: userId, created_at: { gte: start, lt: end } },
      });
      if (used >= DAILY_UPLOAD_LIMIT) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          HttpStatus.TOO_MANY_REQUESTS,
          'Daily upload limit reached',
        );
      }
      await tx.ugcUpload.create({
        data: {
          upload_id: uploadId,
          user_id: userId,
          object_key: objectKey,
          size_bytes: sizeBytes,
          status: UGC_UPLOAD_STATUS.PENDING,
          created_at: now,
        },
      });
    });
  }

  private async assertUgcEnabled(): Promise<void> {
    const config = await this.clientConfig.getClientConfig();
    if (!config.features.ugc) {
      throw new AppError(ERROR_CODES.FEATURE_DISABLED, HttpStatus.FORBIDDEN, 'UGC is disabled');
    }
  }
}
