import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, FEEDBACK_IMAGE_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import {
  ImageProcessorService,
  type UploadedImageFile,
} from '../uploads/image-processor.service';
import type { UploadFeedbackImageResponseDto } from './dto/feedback-response.dto';

export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
const DAILY_IMAGE_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayBounds(now: Date): { start: Date; end: Date } {
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/**
 * C-end feedback screenshot upload. The `feedback_image` row is written before
 * the object so a failed object write can always be tracked and marked deleted.
 *
 * The 10/day quota counts the user's `feedback_image` rows for the current UTC
 * day, including rows later marked deleted, since this is an anti-abuse control
 * over attempts. A per-user advisory transaction lock serializes the count and
 * insert across API instances.
 */
@Injectable()
export class FeedbackImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessorService,
    private readonly clientConfig: ClientConfigService,
  ) {}

  async upload(
    file: UploadedImageFile | undefined,
    appUser: AppUserContext | undefined,
  ): Promise<UploadFeedbackImageResponseDto> {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    await this.assertFeedbackEnabled();
    if (file === undefined || file.buffer === undefined) {
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Image file is required');
    }
    const size = file.size ?? file.buffer.length;
    if (size > MAX_FEEDBACK_IMAGE_BYTES || file.buffer.length > MAX_FEEDBACK_IMAGE_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Image exceeds 5 MB',
      );
    }
    this.images.validateUpload(file.buffer, size);

    const now = new Date();
    const processed = await this.images.process(file.buffer, 'ugc');
    const imageId = ulid();
    const key = `feedback/${appUser.userId}/${imageId}.webp`;
    await this.reserveImageSlot(appUser.userId, imageId, key, processed.data.length, now);

    try {
      await this.storage.putObject(key, processed.data, 'image/webp');
    } catch {
      // Keep an audit trace instead of leaving an object without a row.
      await this.prisma.feedbackImage.updateMany({
        where: { image_id: imageId, status: FEEDBACK_IMAGE_STATUS.PENDING },
        data: { status: FEEDBACK_IMAGE_STATUS.DELETED, deleted_at: new Date() },
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

  private async reserveImageSlot(
    userId: string,
    imageId: string,
    objectKey: string,
    sizeBytes: number,
    now: Date,
  ): Promise<void> {
    const { start, end } = utcDayBounds(now);
    await this.prisma.$transaction(async (tx) => {
      // Serialize per-user quota checks; the lock is released with the transaction.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`feedback-image:${userId}`}))::text`;
      const used = await tx.feedbackImage.count({
        where: { user_id: userId, created_at: { gte: start, lt: end } },
      });
      if (used >= DAILY_IMAGE_LIMIT) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          HttpStatus.TOO_MANY_REQUESTS,
          'Daily feedback image limit reached',
        );
      }
      await tx.feedbackImage.create({
        data: {
          image_id: imageId,
          user_id: userId,
          object_key: objectKey,
          size_bytes: sizeBytes,
          status: FEEDBACK_IMAGE_STATUS.PENDING,
          created_at: now,
        },
      });
    });
  }

  private async assertFeedbackEnabled(): Promise<void> {
    const config = await this.clientConfig.getClientConfig();
    if (!config.features.feedback) {
      throw new AppError(
        ERROR_CODES.FEATURE_DISABLED,
        HttpStatus.FORBIDDEN,
        'Feedback is disabled',
      );
    }
  }
}
