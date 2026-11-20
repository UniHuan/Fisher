import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, TrialFeedback } from '@prisma/client';
import { ERROR_CODES, FEEDBACK_IMAGE_STATUS } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

export interface FeedbackSpotView {
  spot_id: string;
  deleted_at: Date | null;
}

export interface CreateFeedbackRowInput {
  feedbackId: string;
  userId: string;
  category: string;
  content: string;
  contact: string | null;
  page: string | null;
  spotId: string | null;
  appVersion: string | null;
  deviceInfo: Prisma.InputJsonObject | null;
  /** Owned pending FeedbackImage keys, already deduplicated by the service. */
  imageKeys: string[];
  /** Millisecond-precision write time; keeps the admin pagination cursor exact. */
  createdAt: Date;
}

/** Owns every Prisma query for the C-end feedback domain. */
@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSpot(spotId: string): Promise<FeedbackSpotView | null> {
    return this.prisma.spot.findUnique({
      where: { spot_id: spotId },
      select: { spot_id: true, deleted_at: true },
    });
  }

  async findPendingImageKeys(userId: string, keys: string[]): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.prisma.feedbackImage.findMany({
      where: {
        user_id: userId,
        object_key: { in: keys },
        status: FEEDBACK_IMAGE_STATUS.PENDING,
        deleted_at: null,
      },
      select: { object_key: true },
    });
    return rows.map((row) => row.object_key);
  }

  /**
   * Claims the pending images and inserts the feedback in one transaction. If a
   * key stopped being an owned pending row between validation and here, the
   * whole insert rolls back and the caller answers 400.
   */
  createFeedback(input: CreateFeedbackRowInput): Promise<TrialFeedback> {
    return this.prisma.$transaction(async (tx) => {
      if (input.imageKeys.length > 0) {
        const claimed = await tx.feedbackImage.updateMany({
          where: {
            user_id: input.userId,
            object_key: { in: input.imageKeys },
            status: FEEDBACK_IMAGE_STATUS.PENDING,
            deleted_at: null,
          },
          data: { status: FEEDBACK_IMAGE_STATUS.USED },
        });
        if (claimed.count !== input.imageKeys.length) {
          const message = 'Image keys must be pending uploads owned by the current user';
          throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message, [
            { field: 'image_keys', message },
          ]);
        }
      }
      return tx.trialFeedback.create({
        data: {
          feedback_id: input.feedbackId,
          user_id: input.userId,
          category: input.category,
          content: input.content,
          contact: input.contact,
          page: input.page,
          spot_id: input.spotId,
          app_version: input.appVersion,
          ...(input.deviceInfo === null ? {} : { device_info: input.deviceInfo }),
          image_keys: input.imageKeys,
          created_at: input.createdAt,
        },
      });
    });
  }
}
