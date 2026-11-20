import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, FEEDBACK_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext } from '../../common/types/request-context';
import { ClientConfigService } from '../config/config.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  FEEDBACK_IMAGE_KEY_PATTERN,
  type CreateFeedbackDto,
  type FeedbackDeviceInfoDto,
} from './dto/create-feedback.dto';
import type { CreateFeedbackResponseDto } from './dto/feedback-response.dto';
import { FeedbackRepository } from './feedback.repository';

const MIN_CONTENT_CODE_POINTS = 10;
const MAX_CONTENT_CODE_POINTS = 500;
const MAX_IMAGES = 3;
const DAILY_FEEDBACK_LIMIT = 5;
const DAY_SECONDS = 24 * 60 * 60;

const DEVICE_INFO_KEYS = ['model', 'system', 'wechat_version', 'sdk_version'] as const;

function validationError(field: string, message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message, [
    { field, message },
  ]);
}

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/** Stores only the whitelisted context fields; empty values are dropped. */
function toDeviceInfo(input: FeedbackDeviceInfoDto | undefined): Prisma.InputJsonObject | null {
  if (input === undefined) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const key of DEVICE_INFO_KEYS) {
    const value = input[key]?.trim();
    if (value !== undefined && value !== '') {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly clientConfig: ClientConfigService,
    private readonly rateLimit: RateLimitService,
    private readonly repository: FeedbackRepository,
  ) {}

  async create(
    input: CreateFeedbackDto,
    appUser: AppUserContext | undefined,
  ): Promise<CreateFeedbackResponseDto> {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    await this.assertFeedbackEnabled();

    const content = input.content.trim();
    const codePoints = Array.from(content).length;
    if (codePoints < MIN_CONTENT_CODE_POINTS || codePoints > MAX_CONTENT_CODE_POINTS) {
      throw validationError('content', 'Content must be 10 to 500 characters');
    }

    const spotId = optionalText(input.spot_id);
    if (spotId !== null) {
      const spot = await this.repository.findSpot(spotId);
      if (spot === null || spot.deleted_at !== null) {
        throw validationError('spot_id', 'Spot is not available');
      }
    }

    const imageKeys = await this.resolveImageKeys(input.image_keys, appUser.userId);
    const now = new Date();
    await this.enforceDailyLimit(appUser.userId, now);

    const feedbackId = ulid();
    await this.repository.createFeedback({
      feedbackId,
      userId: appUser.userId,
      category: input.category,
      content,
      contact: optionalText(input.contact),
      page: optionalText(input.page),
      spotId,
      appVersion: optionalText(input.app_version),
      deviceInfo: toDeviceInfo(input.device_info),
      imageKeys,
      createdAt: now,
    });

    return { feedback_id: feedbackId, status: FEEDBACK_STATUS.OPEN };
  }

  private async resolveImageKeys(
    imageKeys: string[] | undefined,
    userId: string,
  ): Promise<string[]> {
    const unique = [...new Set(imageKeys ?? [])];
    if (unique.length > MAX_IMAGES) {
      throw validationError('image_keys', 'At most 3 images are allowed');
    }
    if (unique.length === 0) {
      return [];
    }
    for (const key of unique) {
      if (!key.startsWith(`feedback/${userId}/`) || !FEEDBACK_IMAGE_KEY_PATTERN.test(key)) {
        throw validationError('image_keys', 'Image keys must belong to the current user');
      }
    }
    const owned = await this.repository.findPendingImageKeys(userId, unique);
    if (owned.length !== unique.length) {
      throw validationError(
        'image_keys',
        'Image keys must be pending uploads owned by the current user',
      );
    }
    return unique;
  }

  private async enforceDailyLimit(userId: string, now: Date): Promise<void> {
    const decision = await this.rateLimit.hit(`feedback:create:user:${userId}:${utcDayKey(now)}`, {
      limit: DAILY_FEEDBACK_LIMIT,
      windowSeconds: DAY_SECONDS,
    });
    if (!decision.allowed) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        'Daily feedback limit reached',
      );
    }
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
