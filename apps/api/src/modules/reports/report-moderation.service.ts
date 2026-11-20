import { Inject, Injectable, Logger } from '@nestjs/common';
import { MODERATION_STATUS } from '@szfisher/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTENT_SECURITY_PROVIDER,
  ContentSecurityMediaError,
  type ContentSecurityProvider,
  type WechatMediaEvent,
} from '../content-security/content-security.types';
import { StorageService } from '../storage/storage.service';

/** WeChat needs enough time to fetch the work-bucket URL and queue the check. */
export const MEDIA_CHECK_PREVIEW_TTL_SECONDS = 30 * 60;

const logger = new Logger('ReportModeration');

export type MediaCallbackOutcome = 'updated' | 'duplicate' | 'canceled' | 'unknown';

/** Terminal states whose published objects must not survive a racing recompute. */
const NON_PUBLIC_STATUSES: readonly string[] = [
  MODERATION_STATUS.MACHINE_REJECTED,
  MODERATION_STATUS.HUMAN_REJECTED,
  MODERATION_STATUS.REMOVED,
];

function isTextPassed(machineResult: Prisma.JsonValue | null): boolean {
  if (typeof machineResult !== 'object' || machineResult === null) {
    return false;
  }
  return (machineResult as { suggest?: unknown }).suggest === 'pass';
}

function toCheckResult(event: WechatMediaEvent): Prisma.InputJsonObject {
  // Only the conclusion, label and safe error code are persisted.
  return {
    suggest: event.suggest,
    ...(event.label === undefined ? {} : { label: event.label }),
    ...(event.errorCode === undefined ? {} : { error_code: event.errorCode }),
  };
}

/**
 * Recomputes the image moderation state for a report.
 *
 * Only `machine_pending` reports can move: the conditional update guarantees a
 * concurrent human approval/rejection/removal always wins. All images must have
 * a `pass` row and the text check must have passed before any object is copied
 * to the public bucket. Any `risky` image rejects the whole report. `review`,
 * `error`, `timeout`, missing or still-pending checks leave it pending for a human.
 */
export async function recomputeReportModeration(
  prisma: PrismaService,
  storage: StorageService,
  reportId: string,
): Promise<void> {
  const report = await prisma.report.findUnique({
    where: { report_id: reportId },
    select: {
      report_id: true,
      moderation_status: true,
      deleted_at: true,
      machine_result: true,
      images: true,
      user: { select: { status: true, deleted_at: true } },
    },
  });
  if (
    report === null ||
    report.deleted_at !== null ||
    report.moderation_status !== MODERATION_STATUS.MACHINE_PENDING
  ) {
    return;
  }

  const checks = await prisma.reportMediaCheck.findMany({
    where: { report_id: reportId },
    select: { status: true },
  });
  const statuses = checks.map((check) => check.status);

  let target: string = MODERATION_STATUS.MACHINE_PENDING;
  if (statuses.includes('risky')) {
    target = MODERATION_STATUS.MACHINE_REJECTED;
  } else if (
    checks.length === report.images.length &&
    statuses.every((status) => status === 'pass') &&
    isTextPassed(report.machine_result)
  ) {
    target = MODERATION_STATUS.PUBLISHED;
  }
  if (target === MODERATION_STATUS.MACHINE_PENDING) {
    return;
  }

  const now = new Date();
  if (target === MODERATION_STATUS.PUBLISHED) {
    // Every transition into a public status re-checks the author. A ban that
    // committed after the report insert must never be bypassed by a media
    // callback; take the content down instead of publishing it.
    if (report.user.status !== 'active' || report.user.deleted_at !== null) {
      await prisma.report.updateMany({
        where: {
          report_id: reportId,
          deleted_at: null,
          moderation_status: MODERATION_STATUS.MACHINE_PENDING,
        },
        data: {
          moderation_status: MODERATION_STATUS.REMOVED,
          reject_reason: 'user_banned',
          audit_time: now,
        },
      });
      await prisma.reportMediaCheck.updateMany({
        where: { report_id: reportId, status: 'pending' },
        data: { status: 'canceled', checked_at: now },
      });
      return;
    }
    try {
      for (const key of report.images) {
        const basename = key.split('/').pop() ?? '';
        if (basename === '') {
          continue;
        }
        await storage.copyToPublished(key, `ugc/${report.report_id}/${basename}`);
      }
    } catch {
      // A bucket failure must not publish; leave it for the human queue/retry.
      logger.warn(`image publish copy failed; report left pending`);
      return;
    }
  }

  const updated = await prisma.report.updateMany({
    where: {
      report_id: reportId,
      deleted_at: null,
      moderation_status: MODERATION_STATUS.MACHINE_PENDING,
    },
    data: { moderation_status: target },
  });

  if (updated.count === 0 && target === MODERATION_STATUS.PUBLISHED) {
    // A human rejected/removed the report while we were copying. Those
    // transitions already delete published objects; delete the copies we just
    // made so a stale in-flight recompute cannot leave them behind. A concurrent
    // human approval keeps them because that status is public.
    const current = await prisma.report.findUnique({
      where: { report_id: reportId },
      select: { moderation_status: true },
    });
    if (
      current !== null &&
      NON_PUBLIC_STATUSES.includes(current.moderation_status)
    ) {
      for (const key of report.images) {
        const basename = key.split('/').pop() ?? '';
        if (basename === '') {
          continue;
        }
        try {
          await storage.deletePublished(`ugc/${report.report_id}/${basename}`);
        } catch {
          // Best-effort; the admin removal/purge paths remain the backstop.
        }
      }
    }
  }
}

/**
 * Applies one verified `wxa_media_check` callback. Repeated callbacks are
 * idempotent; callbacks that arrive after a human decision (or after the report
 * left `machine_pending`) mark the check `canceled` and never change the report.
 */
export async function recordMediaCheckResult(
  prisma: PrismaService,
  storage: StorageService,
  event: WechatMediaEvent,
): Promise<MediaCallbackOutcome> {
  const check = await prisma.reportMediaCheck.findUnique({
    where: { trace_id: event.traceId },
    select: { trace_id: true, report_id: true, status: true },
  });
  if (check === null) {
    // Safe to log: no trace id, openid, ciphertext or payload is persisted here.
    logger.warn('media check callback for an unknown trace was acknowledged');
    return 'unknown';
  }
  const report = await prisma.report.findUnique({
    where: { report_id: check.report_id },
    select: { moderation_status: true },
  });
  if (report === null) {
    return 'unknown';
  }

  const result = toCheckResult(event);
  if (report.moderation_status !== MODERATION_STATUS.MACHINE_PENDING) {
    if (check.status === 'pending') {
      await prisma.reportMediaCheck.updateMany({
        where: { trace_id: event.traceId, status: 'pending' },
        data: { status: 'canceled', result, checked_at: new Date() },
      });
      return 'canceled';
    }
    return 'duplicate';
  }

  if (check.status !== 'pending') {
    // A retried callback may have reached us after a transient recompute failure;
    // recomputing again is idempotent and lets the report converge.
    await recomputeReportModeration(prisma, storage, check.report_id);
    return 'duplicate';
  }

  const status = event.errorCode === undefined ? event.suggest : 'error';
  const updated = await prisma.reportMediaCheck.updateMany({
    where: { trace_id: event.traceId, status: 'pending' },
    data: { status, result, checked_at: new Date() },
  });
  if (updated.count === 0) {
    return 'duplicate';
  }
  await recomputeReportModeration(prisma, storage, check.report_id);
  return 'updated';
}

@Injectable()
export class ReportModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(CONTENT_SECURITY_PROVIDER)
    private readonly contentSecurity: ContentSecurityProvider,
  ) {}

  /** Submits every image exactly once and records a row even when WeChat fails. */
  async submitImages(reportId: string, imageKeys: string[], openid: string): Promise<void> {
    const existing = await this.prisma.reportMediaCheck.findMany({
      where: { report_id: reportId },
      select: { image_key: true },
    });
    const submitted = new Set(existing.map((row) => row.image_key));

    for (const key of imageKeys) {
      if (submitted.has(key)) {
        continue;
      }
      let traceId: string;
      try {
        const imageUrl = await this.storage.getPreviewUrl(
          key,
          MEDIA_CHECK_PREVIEW_TTL_SECONDS,
        );
        traceId = (await this.contentSecurity.checkMedia({ imageUrl, openid })).traceId;
      } catch (error) {
        const reason =
          error instanceof ContentSecurityMediaError ? error.reason : 'unexpected';
        logger.warn(`media check submission failed (${reason}); report stays pending`);
        await this.createErrorCheck(reportId, key, reason);
        continue;
      }
      try {
        await this.prisma.reportMediaCheck.create({
          data: {
            trace_id: traceId,
            report_id: reportId,
            image_key: key,
            status: 'pending',
          },
        });
      } catch {
        // A trace collision must not let the image skip moderation.
        await this.createErrorCheck(reportId, key, 'trace-persist-failed');
      }
    }

    await this.recompute(reportId);
  }

  recompute(reportId: string): Promise<void> {
    return recomputeReportModeration(this.prisma, this.storage, reportId);
  }

  private async createErrorCheck(
    reportId: string,
    key: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.reportMediaCheck.create({
      data: {
        trace_id: `media-error-${ulid()}`,
        report_id: reportId,
        image_key: key,
        status: 'error',
        result: { error_code: reason },
        checked_at: new Date(),
      },
    });
  }
}
