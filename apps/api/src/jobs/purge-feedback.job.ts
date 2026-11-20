import { NestFactory } from '@nestjs/core';
import { FEEDBACK_IMAGE_STATUS } from '@szfisher/shared';
import { AppModule } from '../app.module';
import { withAdvisoryLock } from '../common/db/advisory-lock';
import { JsonLogger } from '../common/logging/json-logger';
import { StorageService } from '../modules/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

export const FEEDBACK_PURGE_LOCK_KEY = 'feedback:purge';
/** Spec: screenshots that never became feedback are removed after 24 hours. */
export const FEEDBACK_ORPHAN_IMAGE_MS = 24 * 60 * 60 * 1000;
/** Spec: feedback and its images are retained for 90 days. */
export const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Small batches plus a raised transaction timeout keep the advisory lock safe. */
const BATCH_SIZE = 100;
const PURGE_TRANSACTION_TIMEOUT_MS = 120_000;

export interface PurgeFeedbackResult {
  images_deleted: number;
  feedback_deleted: number;
  objects_deleted: number;
}

/**
 * Deletes expired feedback storage:
 *
 * 1. `feedback_image` rows still `pending` after 24 hours, plus their objects.
 *    If any feedback already references the object (for example a crash between
 *    the feedback insert and the image update), the row is marked `used`
 *    instead and the object stays.
 * 2. `trial_feedback` rows older than 90 days, in the same transaction that
 *    marks their image rows `deleted`.
 * 3. Any `deleted` image row no feedback references: the object is removed and
 *    the row dropped. Rows still referenced by a retained feedback keep their
 *    object for the later retention run.
 *
 * Object deletes happen outside the database transaction; a bucket failure
 * leaves the row in place so the next scheduled run retries it.
 */
export async function purgeFeedback(
  prisma: PrismaService,
  storage: StorageService,
  now: Date = new Date(),
): Promise<PurgeFeedbackResult | null> {
  return withAdvisoryLock(
    prisma,
    FEEDBACK_PURGE_LOCK_KEY,
    async () => {
      let imagesDeleted = 0;
      let feedbackDeleted = 0;
      let objectsDeleted = 0;

      const orphanCutoff = new Date(now.getTime() - FEEDBACK_ORPHAN_IMAGE_MS);
      const pendingImages = await prisma.feedbackImage.findMany({
        where: {
          status: FEEDBACK_IMAGE_STATUS.PENDING,
          created_at: { lt: orphanCutoff },
        },
        select: { image_id: true, object_key: true },
        take: BATCH_SIZE,
      });
      for (const image of pendingImages) {
        const referenced = await prisma.trialFeedback.count({
          where: { image_keys: { has: image.object_key } },
        });
        if (referenced > 0) {
          await prisma.feedbackImage.updateMany({
            where: { image_id: image.image_id, status: FEEDBACK_IMAGE_STATUS.PENDING },
            data: { status: FEEDBACK_IMAGE_STATUS.USED },
          });
          continue;
        }

        try {
          await storage.deleteObject(image.object_key);
        } catch {
          // Leave the row pending so the next run retries the object delete.
          continue;
        }
        objectsDeleted += 1;
        const removed = await prisma.feedbackImage.deleteMany({
          where: { image_id: image.image_id, status: FEEDBACK_IMAGE_STATUS.PENDING },
        });
        imagesDeleted += removed.count;
      }

      const retentionCutoff = new Date(now.getTime() - FEEDBACK_RETENTION_MS);
      const staleFeedback = await prisma.trialFeedback.findMany({
        where: { created_at: { lt: retentionCutoff } },
        select: { feedback_id: true, image_keys: true },
        take: BATCH_SIZE,
      });
      for (const feedback of staleFeedback) {
        const removed = await prisma.$transaction(async (tx) => {
          const deleted = await tx.trialFeedback.deleteMany({
            where: { feedback_id: feedback.feedback_id, created_at: { lt: retentionCutoff } },
          });
          if (deleted.count === 0) {
            return false;
          }
          if (feedback.image_keys.length > 0) {
            await tx.feedbackImage.updateMany({
              where: {
                object_key: { in: feedback.image_keys },
                status: { not: FEEDBACK_IMAGE_STATUS.DELETED },
              },
              data: { status: FEEDBACK_IMAGE_STATUS.DELETED, deleted_at: now },
            });
          }
          return true;
        });
        if (removed) {
          feedbackDeleted += 1;
        }
      }

      const deletedImages = await prisma.feedbackImage.findMany({
        where: { status: FEEDBACK_IMAGE_STATUS.DELETED },
        select: { image_id: true, object_key: true },
        take: BATCH_SIZE,
      });
      for (const image of deletedImages) {
        const referenced = await prisma.trialFeedback.count({
          where: { image_keys: { has: image.object_key } },
        });
        if (referenced > 0) {
          continue;
        }
        try {
          await storage.deleteObject(image.object_key);
        } catch {
          // The deleted row keeps the retry pointer for the next run.
          continue;
        }
        objectsDeleted += 1;
        const removed = await prisma.feedbackImage.deleteMany({
          where: { image_id: image.image_id, status: FEEDBACK_IMAGE_STATUS.DELETED },
        });
        imagesDeleted += removed.count;
      }

      return {
        images_deleted: imagesDeleted,
        feedback_deleted: feedbackDeleted,
        objects_deleted: objectsDeleted,
      };
    },
    { timeoutMs: PURGE_TRANSACTION_TIMEOUT_MS },
  );
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const result = await purgeFeedback(app.get(PrismaService), app.get(StorageService));
    process.stdout.write(
      `${JSON.stringify({
        event: 'feedback_purge',
        ...(result ?? { skipped: true }),
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

// Guarded so tests can import purgeFeedback without starting an app.
if (require.main === module) {
  void main();
}
