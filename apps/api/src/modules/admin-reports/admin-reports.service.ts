import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, MODERATION_STATUS } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { publicReportImages } from '../reports/report.mapper';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { PreviewSignerService } from '../uploads/preview-signer.service';
import {
  ADMIN_PUBLIC_STATUSES,
  ADMIN_SLA_HOURS,
  AdminReportsRepository,
  decodeAdminCursor,
  encodeAdminCursor,
  type AdminAbuseRow,
  type AdminQueueCursor,
  type AdminReportRow,
} from './admin-reports.repository';
import type {
  AdminAbuseListQueryDto,
  AdminReportListQueryDto,
  AdminReportQueue,
} from './dto/admin-report-list-query.dto';
import type {
  AdminAbuseHandleResponseDto,
  AdminAbuseItemDto,
  AdminAbusePageDto,
  AdminReportActionDto,
  AdminReportHistoryDto,
  AdminReportItemDto,
  AdminReportPageDto,
  AdminReportSummaryDto,
  AdminUserBanResponseDto,
  AdminUserRestrictResponseDto,
} from './dto/admin-report-response.dto';
import type { AbuseHandleAction, HandleAbuseDto } from './dto/handle-abuse.dto';
import type { BanUserDto, RestrictUserDto } from './dto/restrict-user.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const QUEUE_STATUSES: Record<AdminReportQueue, readonly string[]> = {
  spot_check: [MODERATION_STATUS.PUBLISHED],
  pending: [MODERATION_STATUS.MACHINE_PENDING],
  rejected: [MODERATION_STATUS.MACHINE_REJECTED, MODERATION_STATUS.HUMAN_REJECTED],
  removed: [MODERATION_STATUS.REMOVED],
};

const ABUSE_REMOVE_REASON = 'abuse_removed';
const ABUSE_DISMISS_REASON = 'abuse_dismissed';

function reportNotFound(): AppError {
  return new AppError(ERROR_CODES.REPORT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Content not found');
}

function notFound(message: string): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, message);
}

function conflict(message: string): AppError {
  return new AppError(ERROR_CODES.STATE_CONFLICT, HttpStatus.CONFLICT, message);
}

function validationError(field: string, message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message, [
    { field, message },
  ]);
}

function ageHours(createdAt: Date, now: Date): number {
  const hours = (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
  return Math.max(0, Math.round(hours * 10) / 10);
}

function isPublicStatus(status: string): boolean {
  return ADMIN_PUBLIC_STATUSES.includes(status);
}

/** Reads one string field from an audit JSON payload without exposing the blob. */
function jsonStringField(value: Prisma.JsonValue | null, field: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const found = (value as Record<string, unknown>)[field];
  return typeof found === 'string' ? found : null;
}

function slaFilter(
  now: Date,
  overdue: boolean | undefined,
): { cutoff: Date; overdue: boolean } | undefined {
  if (overdue === undefined) {
    return undefined;
  }
  return {
    cutoff: new Date(now.getTime() - ADMIN_SLA_HOURS * HOUR_MS),
    overdue,
  };
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

function decodeCursor(cursor: string | undefined): AdminQueueCursor | null {
  if (cursor === undefined) {
    return null;
  }
  const decoded = decodeAdminCursor(cursor);
  if (decoded === null) {
    throw validationError('cursor', 'Invalid cursor');
  }
  return decoded;
}

@Injectable()
export class AdminReportsService {
  private readonly logger = new Logger(AdminReportsService.name);

  constructor(
    private readonly repository: AdminReportsRepository,
    private readonly storage: StorageService,
    private readonly previewSigner: PreviewSignerService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async listReports(query: AdminReportListQueryDto): Promise<AdminReportPageDto> {
    const now = new Date();
    const queue = query.queue ?? 'spot_check';
    const limit = pageSize(query.limit);
    const { rows, total, hasMore } = await this.repository.listReports({
      statuses: QUEUE_STATUSES[queue],
      contentType: query.content_type,
      spotId: query.spot_id,
      spotName: query.spot_name,
      slaFilter: slaFilter(now, query.sla_overdue),
      cursor: decodeCursor(query.cursor),
      limit,
    });
    const rejectedCounts = await this.repository.authorRejectedCounts(
      [...new Set(rows.map((row) => row.user_id))],
    );
    const abuseCounts = await this.repository.pendingAbuseCounts(
      rows.map((row) => row.report_id),
    );
    const last = rows[rows.length - 1];
    return {
      items: rows.map((row) => this.toReportItem(row, now, rejectedCounts, abuseCounts)),
      next_cursor: hasMore && last !== undefined
        ? encodeAdminCursor(last.created_at, last.report_id)
        : null,
      total,
    };
  }

  async summary(): Promise<AdminReportSummaryDto> {
    return this.repository.summaryCounts(new Date());
  }

  /**
   * One report in the same shape as a queue row. The abuse queue only carries a
   * content summary, so the drawer fetches this to reuse the report detail view
   * (images, author, machine result and history).
   */
  async reportDetail(reportId: string): Promise<AdminReportItemDto> {
    const report = await this.requireReport(reportId);
    const now = new Date();
    const [rejectedCounts, abuseCounts] = await Promise.all([
      this.repository.authorRejectedCounts([report.user_id]),
      this.repository.pendingAbuseCounts([report.report_id]),
    ]);
    return this.toReportItem(report, now, rejectedCounts, abuseCounts);
  }

  /**
   * Report scoped history for the detail drawer. Reviewers may read it because
   * it is bounded to this report and exposes only action, statuses, reason,
   * actor and time; content bodies, image URLs and reporter identities stay out.
   */
  async reportHistory(reportId: string): Promise<AdminReportHistoryDto> {
    const report = await this.requireReport(reportId);
    const [audits, abuses] = await Promise.all([
      this.repository.listReportAudits(report.report_id),
      this.repository.listReportAbuses(report.report_id),
    ]);
    return {
      report_id: report.report_id,
      audit: audits.map((row) => ({
        log_id: row.log_id,
        action: row.action,
        status_before: jsonStringField(row.before_json, 'moderation_status'),
        status_after: jsonStringField(row.after_json, 'moderation_status'),
        reason: jsonStringField(row.after_json, 'reason'),
        admin_id: row.admin_id,
        created_at: row.created_at.toISOString(),
      })),
      abuses: abuses.map((row) => ({
        abuse_id: row.abuse_id,
        reason: row.reason,
        status: row.status,
        created_at: row.created_at.toISOString(),
        handled_at: row.handled_at === null ? null : row.handled_at.toISOString(),
      })),
    };
  }

  async approve(
    reportId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    const report = await this.requireReport(reportId);
    if (
      report.moderation_status !== MODERATION_STATUS.PUBLISHED &&
      report.moderation_status !== MODERATION_STATUS.MACHINE_PENDING
    ) {
      throw conflict('Content cannot be approved in its current state');
    }

    const needsCopy =
      report.moderation_status === MODERATION_STATUS.MACHINE_PENDING &&
      report.images.length > 0;
    if (needsCopy) {
      // A bucket failure throws 503 before any state changes, so the row is
      // still pending and the operator can retry.
      await this.copyPublishedImages(reportId, report.images);
    }

    const now = new Date();
    const updated = await this.repository.approveReport(reportId, admin.adminId, now);
    if (!updated) {
      if (needsCopy) {
        // Another action won the race (for example a concurrent reject). Remove
        // the copies we just made unless the winner left the content public.
        const current = await this.repository.findModerationStatus(reportId);
        if (current === null || !isPublicStatus(current)) {
          await this.deletePublishedImages(reportId, report.images);
        }
      }
      throw await this.conflictOrNotFound(reportId);
    }

    await this.recordAudit(admin, request, {
      action: 'report.approve',
      entityType: 'report',
      entityId: reportId,
      before: { moderation_status: report.moderation_status },
      after: { moderation_status: MODERATION_STATUS.HUMAN_APPROVED },
    });
    return {
      report_id: reportId,
      moderation_status: MODERATION_STATUS.HUMAN_APPROVED,
      adopted_at: null,
      adopted_by: null,
    };
  }

  async reject(
    reportId: string,
    reason: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    const report = await this.requireReport(reportId);
    if (
      report.moderation_status !== MODERATION_STATUS.PUBLISHED &&
      report.moderation_status !== MODERATION_STATUS.MACHINE_PENDING
    ) {
      throw conflict('Content cannot be rejected in its current state');
    }

    const now = new Date();
    const updated = await this.repository.rejectReport(reportId, admin.adminId, now, reason);
    if (!updated) {
      throw await this.conflictOrNotFound(reportId);
    }
    // Work-bucket keys stay on the row as the purge-job retry pointer.
    await this.deletePublishedImages(reportId, report.images);

    await this.recordAudit(admin, request, {
      action: 'report.reject',
      entityType: 'report',
      entityId: reportId,
      before: { moderation_status: report.moderation_status },
      after: { moderation_status: MODERATION_STATUS.HUMAN_REJECTED, reason },
    });
    return {
      report_id: reportId,
      moderation_status: MODERATION_STATUS.HUMAN_REJECTED,
      adopted_at: null,
      adopted_by: null,
    };
  }

  async remove(
    reportId: string,
    reason: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    const report = await this.requireReport(reportId);
    if (!isPublicStatus(report.moderation_status)) {
      throw conflict('Only published content can be removed');
    }

    const now = new Date();
    const updated = await this.repository.removeReport(reportId, admin.adminId, now, reason);
    if (!updated) {
      throw await this.conflictOrNotFound(reportId);
    }
    await this.deletePublishedImages(reportId, report.images);

    await this.recordAudit(admin, request, {
      action: 'report.remove',
      entityType: 'report',
      entityId: reportId,
      before: { moderation_status: report.moderation_status },
      after: { moderation_status: MODERATION_STATUS.REMOVED, reason },
    });
    return {
      report_id: reportId,
      moderation_status: MODERATION_STATUS.REMOVED,
      adopted_at: null,
      adopted_by: null,
    };
  }

  async adopt(
    reportId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    const report = await this.requireReport(reportId);
    if (report.content_type !== 'intel' || !isPublicStatus(report.moderation_status)) {
      throw conflict('Only publicly visible intel can be adopted');
    }

    const now = new Date();
    const updated = await this.repository.adoptReport(reportId, admin.adminId, now);
    if (!updated) {
      throw await this.conflictOrNotFound(reportId);
    }

    await this.recordAudit(admin, request, {
      action: 'report.adopt',
      entityType: 'report',
      entityId: reportId,
      before: {
        adopted_at: report.adopted_at === null ? null : report.adopted_at.toISOString(),
        adopted_by: report.adopted_by,
      },
      after: { adopted_at: now.toISOString(), adopted_by: admin.adminId },
    });
    return {
      report_id: reportId,
      moderation_status: report.moderation_status,
      adopted_at: now.toISOString(),
      adopted_by: admin.adminId,
    };
  }

  async listAbuses(query: AdminAbuseListQueryDto): Promise<AdminAbusePageDto> {
    const now = new Date();
    const limit = pageSize(query.limit);
    const { rows, total, hasMore } = await this.repository.listAbuses({
      status: query.status ?? 'pending',
      spotName: query.spot_name,
      slaFilter: slaFilter(now, query.sla_overdue),
      cursor: decodeCursor(query.cursor),
      limit,
    });
    const last = rows[rows.length - 1];
    return {
      items: rows.map((row) => this.toAbuseItem(row, now)),
      next_cursor: hasMore && last !== undefined
        ? encodeAdminCursor(last.created_at, last.abuse_id)
        : null,
      total,
    };
  }

  async handleAbuse(
    abuseId: string,
    body: HandleAbuseDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminAbuseHandleResponseDto> {
    const abuse = await this.repository.findAbuse(abuseId);
    if (abuse === null) {
      throw notFound('Abuse report not found');
    }
    if (abuse.status !== 'pending') {
      throw conflict('Abuse report has already been handled');
    }

    const now = new Date();
    const actionReason = this.abuseReason(body.action, body.reason);
    if (body.action === 'dismiss') {
      const updated = await this.repository.dismissAbuse(abuseId, admin.adminId, now);
      if (!updated) {
        throw conflict('Abuse report has already been handled');
      }
      await this.recordAudit(admin, request, {
        action: 'abuse.handle',
        entityType: 'report_abuse',
        entityId: abuseId,
        before: {
          abuse_status: 'pending',
          moderation_status: abuse.report.moderation_status,
        },
        after: {
          abuse_status: 'dismissed',
          moderation_status: abuse.report.moderation_status,
          reason: actionReason,
        },
      });
      return {
        abuse_id: abuseId,
        report_id: abuse.report_id,
        status: 'dismissed',
        moderation_status: abuse.report.moderation_status,
      };
    }

    const result = await this.repository.removeAbuse(
      abuseId,
      admin.adminId,
      now,
      actionReason,
    );
    if (result === null) {
      throw conflict('Abuse report has already been handled');
    }
    await this.deletePublishedImages(result.report_id, result.images);

    await this.recordAudit(admin, request, {
      action: 'abuse.handle',
      entityType: 'report_abuse',
      entityId: abuseId,
      before: {
        abuse_status: 'pending',
        moderation_status: result.report_status_before,
      },
      after: {
        abuse_status: 'removed',
        moderation_status: result.report_status_after,
        reason: actionReason,
      },
    });
    return {
      abuse_id: abuseId,
      report_id: result.report_id,
      status: 'removed',
      moderation_status: result.report_status_after,
    };
  }

  async restrictUser(
    userId: string,
    body: RestrictUserDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminUserRestrictResponseDto> {
    const user = await this.repository.findAppUser(userId);
    if (user === null || user.deleted_at !== null) {
      throw notFound('User not found');
    }
    if (user.status === 'banned') {
      throw conflict('A banned user cannot be restricted');
    }

    const now = new Date();
    const restrictedUntil = new Date(now.getTime() + body.days * DAY_MS);
    await this.repository.setRestrictedUntil(userId, restrictedUntil);

    await this.recordAudit(admin, request, {
      action: 'user.restrict',
      entityType: 'user',
      entityId: userId,
      before: {
        restricted_until: user.restricted_until === null
          ? null
          : user.restricted_until.toISOString(),
      },
      after: {
        restricted_until: restrictedUntil.toISOString(),
        days: body.days,
        reason: body.reason,
      },
    });
    return { user_id: userId, restricted_until: restrictedUntil.toISOString() };
  }

  async unrestrictUser(
    userId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminUserRestrictResponseDto> {
    const user = await this.repository.findAppUser(userId);
    if (user === null || user.deleted_at !== null) {
      throw notFound('User not found');
    }

    await this.repository.setRestrictedUntil(userId, null);

    await this.recordAudit(admin, request, {
      action: 'user.unrestrict',
      entityType: 'user',
      entityId: userId,
      before: {
        restricted_until: user.restricted_until === null
          ? null
          : user.restricted_until.toISOString(),
      },
      after: { restricted_until: null },
    });
    return { user_id: userId, restricted_until: null };
  }

  async banUser(
    userId: string,
    body: BanUserDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminUserBanResponseDto> {
    const result = await this.repository.banUser(userId, admin.adminId, new Date());
    if (result.kind === 'not_found') {
      throw notFound('User not found');
    }
    if (result.kind === 'conflict') {
      throw conflict('User is already banned');
    }

    for (const report of result.removed_reports) {
      await this.deletePublishedImages(report.report_id, report.images);
    }

    await this.recordAudit(admin, request, {
      action: 'user.ban',
      entityType: 'user',
      entityId: userId,
      before: {
        status: result.before.status,
        restricted_until: result.before.restricted_until === null
          ? null
          : result.before.restricted_until.toISOString(),
      },
      after: {
        status: 'banned',
        reason: body.reason,
        removed_reports: result.removed_reports.length,
      },
    });
    return { user_id: userId, status: 'banned' };
  }

  async unbanUser(
    userId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminUserBanResponseDto> {
    const result = await this.repository.unbanUser(userId);
    if (result.kind === 'not_found') {
      throw notFound('User not found');
    }
    if (result.kind === 'conflict') {
      throw conflict('User is not banned');
    }

    await this.recordAudit(admin, request, {
      action: 'user.unban',
      entityType: 'user',
      entityId: userId,
      before: { status: 'banned' },
      // Removed content stays removed; unban only restores the account.
      after: { status: 'active' },
    });
    return { user_id: userId, status: 'active' };
  }

  private async requireReport(reportId: string): Promise<AdminReportRow> {
    const report = await this.repository.findReport(reportId);
    if (report === null || report.deleted_at !== null) {
      throw reportNotFound();
    }
    return report;
  }

  private async conflictOrNotFound(reportId: string): Promise<AppError> {
    const current = await this.repository.findModerationStatus(reportId);
    if (current === null) {
      return reportNotFound();
    }
    return conflict(`Content is already in state ${current}`);
  }

  private abuseReason(action: AbuseHandleAction, reason: string | undefined): string {
    const trimmed = reason?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
    return action === 'remove' ? ABUSE_REMOVE_REASON : ABUSE_DISMISS_REASON;
  }

  private async copyPublishedImages(reportId: string, imageKeys: string[]): Promise<void> {
    for (const key of imageKeys) {
      const basename = key.split('/').pop() ?? '';
      if (basename === '') {
        continue;
      }
      await this.storage.copyToPublished(key, `ugc/${reportId}/${basename}`);
    }
  }

  /**
   * Best-effort published-bucket cleanup. A failed delete is logged without keys
   * and retried by the purge job from the report's retained `images` pointer.
   */
  private async deletePublishedImages(reportId: string, imageKeys: string[]): Promise<void> {
    for (const key of imageKeys) {
      const basename = key.split('/').pop() ?? '';
      if (basename === '') {
        continue;
      }
      try {
        await this.storage.deletePublished(`ugc/${reportId}/${basename}`);
      } catch {
        this.logger.warn('Published image removal failed; the purge job will retry');
      }
    }
  }

  private imageUrls(reportId: string, status: string, images: string[]): string[] {
    if (isPublicStatus(status)) {
      return publicReportImages(reportId, images);
    }
    const urls: string[] = [];
    for (const key of images) {
      try {
        urls.push(this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS).url);
      } catch {
        // Skip malformed legacy keys rather than failing the whole queue page.
      }
    }
    return urls;
  }

  private toReportItem(
    row: AdminReportRow,
    now: Date,
    rejectedCounts: ReadonlyMap<string, number>,
    abuseCounts: ReadonlyMap<string, number>,
  ): AdminReportItemDto {
    const hours = ageHours(row.created_at, now);
    return {
      report_id: row.report_id,
      spot_id: row.spot_id,
      spot_name: row.spot.spot_name,
      content_type: row.content_type,
      content: row.content,
      images: this.imageUrls(row.report_id, row.moderation_status, row.images),
      fish_key: row.fish_key,
      catch_weight_kg: row.catch_weight_kg === null ? null : row.catch_weight_kg.toFixed(2),
      moderation_status: row.moderation_status,
      machine_result: row.machine_result === null
        ? null
        : (row.machine_result as Record<string, unknown>),
      reject_reason: row.reject_reason,
      like_count: row.like_count,
      abuse_count: abuseCounts.get(row.report_id) ?? 0,
      is_adopted: row.adopted_at !== null,
      created_at: row.created_at.toISOString(),
      audit_time: row.audit_time === null ? null : row.audit_time.toISOString(),
      auditor_id: row.auditor_id,
      adopted_at: row.adopted_at === null ? null : row.adopted_at.toISOString(),
      adopted_by: row.adopted_by,
      age_hours: hours,
      sla_overdue: hours > 24,
      author: {
        user_id: row.user.user_id,
        nickname: row.user.nickname,
        status: row.user.status,
        restricted_until: row.user.restricted_until === null
          ? null
          : row.user.restricted_until.toISOString(),
        created_at: row.user.created_at.toISOString(),
        rejected_count: rejectedCounts.get(row.user.user_id) ?? 0,
      },
    };
  }

  private toAbuseItem(row: AdminAbuseRow, now: Date): AdminAbuseItemDto {
    const hours = ageHours(row.created_at, now);
    return {
      abuse_id: row.abuse_id,
      report_id: row.report_id,
      reason: row.reason,
      status: row.status,
      created_at: row.created_at.toISOString(),
      handled_at: row.handled_at === null ? null : row.handled_at.toISOString(),
      age_hours: hours,
      sla_overdue: hours > 24,
      report: {
        spot_id: row.report.spot_id,
        spot_name: row.report.spot.spot_name,
        content_type: row.report.content_type,
        content: row.report.content,
        moderation_status: row.report.moderation_status,
        images: this.imageUrls(
          row.report.report_id,
          row.report.moderation_status,
          row.report.images,
        ),
      },
    };
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    input: {
      action: string;
      entityType: string;
      entityId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
