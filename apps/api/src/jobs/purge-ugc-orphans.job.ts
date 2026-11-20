import { NestFactory } from '@nestjs/core';
import { MODERATION_STATUS } from '@szfisher/shared';
import { AppModule } from '../app.module';
import { withAdvisoryLock } from '../common/db/advisory-lock';
import { JsonLogger } from '../common/logging/json-logger';
import { StorageService } from '../modules/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

const PURGE_LOCK_KEY = 'ugc:purge-orphans';
/** Spec 6.4: uploads that never became content are removed after 24 hours. */
export const PENDING_UPLOAD_ORPHAN_MS = 24 * 60 * 60 * 1000;
/** Spec 6.4: rejected/removed work images are kept 30 days for appeals. */
export const REJECTED_IMAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Author deletion already attempts the object deletes inline. If a bucket call
 * failed, `report.images` / the deleted upload row keep the pointer; retry on
 * every run for this long instead of waiting for the 30-day appeal window.
 */
export const DELETED_OBJECT_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
/** Small batches plus a raised transaction timeout keep the advisory lock safe. */
const BATCH_SIZE = 100;
const PURGE_TRANSACTION_TIMEOUT_MS = 120_000;
const AUTHOR_DELETED_REASON = 'author_deleted';

const TERMINAL_IMAGE_STATUSES: readonly string[] = [
  MODERATION_STATUS.MACHINE_REJECTED,
  MODERATION_STATUS.HUMAN_REJECTED,
  MODERATION_STATUS.REMOVED,
];

export interface PurgeUgcOrphansResult {
  uploads_marked_deleted: number;
  uploads_marked_used: number;
  objects_deleted: number;
}

/**
 * Deletes work- and published-bucket waste:
 *
 * 1. `ugc_upload` rows still `pending` after 24 hours. If any report already
 *    references the object (for example a crash between the report insert and
 *    the upload update), the row is marked `used` instead and the object stays.
 * 2. `ugc_upload` rows already marked `deleted` that still have an object
 *    behind them. This is the retry path for a failed author-deletion delete;
 *    the scan is bounded to `DELETED_OBJECT_RETRY_MS`.
 * 3. Images of terminal reports (`removed` / machine or human rejected): the
 *    author-deleted tombstones are retried on every run, while rejected and
 *    admin-removed reports wait out the 30-day appeal window. Both the work
 *    object and the derived published object are removed, and `images` is
 *    cleared only for keys that were fully cleaned. An object shared with any
 *    non-terminal report keeps its work object and DB key.
 */
export async function purgeUgcOrphans(
  prisma: PrismaService,
  storage: StorageService,
  now: Date = new Date(),
): Promise<PurgeUgcOrphansResult | null> {
  return withAdvisoryLock(
    prisma,
    PURGE_LOCK_KEY,
    async () => {
      let uploadsMarkedDeleted = 0;
      let uploadsMarkedUsed = 0;
      let objectsDeleted = 0;

      const pendingCutoff = new Date(now.getTime() - PENDING_UPLOAD_ORPHAN_MS);
      const pendingUploads = await prisma.ugcUpload.findMany({
        where: { status: 'pending', deleted_at: null, created_at: { lt: pendingCutoff } },
        select: { upload_id: true, object_key: true },
        take: BATCH_SIZE,
      });
      for (const upload of pendingUploads) {
        const referenced = await prisma.report.count({
          where: { images: { has: upload.object_key } },
        });
        if (referenced > 0) {
          const claimed = await prisma.ugcUpload.updateMany({
            where: { upload_id: upload.upload_id, status: 'pending' },
            data: { status: 'used', used_at: now },
          });
          uploadsMarkedUsed += claimed.count;
          continue;
        }

        try {
          await storage.deleteObject(upload.object_key);
        } catch {
          // Leave the row pending so the next run retries the object delete.
          continue;
        }
        const marked = await prisma.ugcUpload.updateMany({
          where: { upload_id: upload.upload_id, status: 'pending' },
          data: { status: 'deleted', deleted_at: now },
        });
        uploadsMarkedDeleted += marked.count;
        objectsDeleted += 1;
      }

      // Retry objects whose upload row was already marked deleted. An author
      // deletion marks uploads deleted before calling storage, so a bucket
      // failure leaves this pointer behind until a later run succeeds.
      const deletedUploadCutoff = new Date(now.getTime() - DELETED_OBJECT_RETRY_MS);
      const deletedUploads = await prisma.ugcUpload.findMany({
        where: {
          status: 'deleted',
          deleted_at: { gte: deletedUploadCutoff },
        },
        select: { object_key: true },
        take: BATCH_SIZE,
      });
      for (const upload of deletedUploads) {
        const live = await prisma.report.count({
          where: {
            images: { has: upload.object_key },
            moderation_status: { notIn: [...TERMINAL_IMAGE_STATUSES] },
          },
        });
        if (live > 0) {
          continue;
        }
        try {
          await storage.deleteObject(upload.object_key);
          objectsDeleted += 1;
        } catch {
          // Retry on the next scheduled run while the row is in the window.
        }
      }

      const imageCutoff = new Date(now.getTime() - REJECTED_IMAGE_RETENTION_MS);
      const staleReports = await prisma.report.findMany({
        where: {
          moderation_status: { in: [...TERMINAL_IMAGE_STATUSES] },
          images: { isEmpty: false },
          OR: [
            // Author deletion already tried inline; retry immediately.
            { reject_reason: AUTHOR_DELETED_REASON },
            { audit_time: { lt: imageCutoff } },
            { audit_time: null, updated_at: { lt: imageCutoff } },
          ],
        },
        select: { report_id: true, images: true },
        take: BATCH_SIZE,
      });
      for (const report of staleReports) {
        const retainedKeys: string[] = [];
        for (const key of report.images) {
          const basename = key.split('/').pop() ?? '';
          const publishedKey = basename === '' ? null : `ugc/${report.report_id}/${basename}`;
          const live = await prisma.report.count({
            where: {
              images: { has: key },
              moderation_status: { notIn: [...TERMINAL_IMAGE_STATUSES] },
            },
          });
          if (live > 0) {
            // Another report still serves the work object. Remove only this
            // report's published copy and keep the key as the retry pointer.
            if (publishedKey !== null) {
              try {
                await storage.deletePublished(publishedKey);
                objectsDeleted += 1;
              } catch {
                // The retained key makes the next run retry.
              }
            }
            retainedKeys.push(key);
            continue;
          }

          let removed = true;
          try {
            await storage.deleteObject(key);
            objectsDeleted += 1;
          } catch {
            removed = false;
          }
          if (publishedKey !== null) {
            try {
              await storage.deletePublished(publishedKey);
              objectsDeleted += 1;
            } catch {
              removed = false;
            }
          }
          if (!removed) {
            retainedKeys.push(key);
          }
        }
        if (retainedKeys.length !== report.images.length) {
          await prisma.report.update({
            where: { report_id: report.report_id },
            data: { images: retainedKeys },
          });
        }
      }

      return {
        uploads_marked_deleted: uploadsMarkedDeleted,
        uploads_marked_used: uploadsMarkedUsed,
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
    const result = await purgeUgcOrphans(app.get(PrismaService), app.get(StorageService));
    process.stdout.write(
      `${JSON.stringify({
        event: 'ugc_orphans_purge',
        ...(result ?? { skipped: true }),
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

// Guarded so tests can import purgeUgcOrphans without starting an app.
if (require.main === module) {
  void main();
}
