import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, UGC_UPLOAD_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientConfigService } from '../config/config.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import type { UploadUgcResponseDto } from './dto/upload-ugc-response.dto';
import { ImageProcessorService, type UploadedImageFile } from './image-processor.service';

const DAILY_UPLOAD_LIMIT = 30;
const DAILY_UPLOAD_WINDOW_SECONDS = 24 * 60 * 60;

function uploadDayKey(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * C-end image upload. The `ugc_upload` row is written before the object so a
 * failed object write can always be tracked and marked deleted; the daily quota
 * is shared through Postgres so two API instances cannot double-spend it.
 */
@Injectable()
export class UploadsUgcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessorService,
    private readonly clientConfig: ClientConfigService,
    private readonly rateLimit: RateLimitService,
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
    await this.enforceDailyLimit(appUser.userId, now);

    const processed = await this.images.process(file.buffer, 'ugc');
    const uploadId = ulid();
    const key = `ugc/${appUser.userId}/${uploadId}.webp`;
    await this.prisma.ugcUpload.create({
      data: {
        upload_id: uploadId,
        user_id: appUser.userId,
        object_key: key,
        size_bytes: processed.data.length,
        status: UGC_UPLOAD_STATUS.PENDING,
      },
    });

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

  private async enforceDailyLimit(userId: string, now: Date): Promise<void> {
    const decision = await this.rateLimit.hit(
      `upload:user:${userId}:${uploadDayKey(now)}`,
      { limit: DAILY_UPLOAD_LIMIT, windowSeconds: DAILY_UPLOAD_WINDOW_SECONDS },
      now,
    );
    if (!decision.allowed) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        'Daily upload limit reached',
      );
    }
  }

  private async assertUgcEnabled(): Promise<void> {
    const config = await this.clientConfig.getClientConfig();
    if (!config.features.ugc) {
      throw new AppError(ERROR_CODES.FEATURE_DISABLED, HttpStatus.FORBIDDEN, 'UGC is disabled');
    }
  }
}
