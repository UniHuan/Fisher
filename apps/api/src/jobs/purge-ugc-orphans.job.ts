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
/** Small batches plus a raised transaction timeout keep the advisory lock safe. */
const BATCH_SIZE = 100;
const PURGE_TRANSACTION_TIMEOUT_MS = 120_000;

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
 * Deletes two kinds of work-bucket waste:
 *
 * 1. `ugc_upload` rows still `pending` after 24 hours. If any report already
 *    references the object (for example a crash between the report insert and
 *    the upload update), the row is marked `used` instead and the object stays.
 * 2. Work images of reports rejected/removed more than 30 days ago. An object
 *    shared with any non-terminal report is never deleted; DB keys are kept.
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

      const imageCutoff = new Date(now.getTime() - REJECTED_IMAGE_RETENTION_MS);
      const staleReports = await prisma.report.findMany({
        where: {
          moderation_status: { in: [...TERMINAL_IMAGE_STATUSES] },
          images: { isEmpty: false },
          OR: [
            { audit_time: { lt: imageCutoff } },
            { audit_time: null, updated_at: { lt: imageCutoff } },
          ],
        },
        select: { images: true },
        take: BATCH_SIZE,
      });
      const seenKeys = new Set<string>();
      for (const report of staleReports) {
        for (const key of report.images) {
          if (seenKeys.has(key)) {
            continue;
          }
          seenKeys.add(key);
          const live = await prisma.report.count({
            where: {
              images: { has: key },
              moderation_status: { notIn: [...TERMINAL_IMAGE_STATUSES] },
            },
          });
          if (live > 0) {
            continue;
          }
          try {
            await storage.deleteObject(key);
            objectsDeleted += 1;
          } catch {
            // Retry on the next scheduled run.
          }
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
