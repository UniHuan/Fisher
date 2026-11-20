import { Injectable } from '@nestjs/common';
import { isUlid, MODERATION_STATUS } from '@szfisher/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const ADMIN_PUBLIC_STATUSES: readonly string[] = [
  MODERATION_STATUS.PUBLISHED,
  MODERATION_STATUS.HUMAN_APPROVED,
];

export const ADMIN_SLA_HOURS = 24;

const VISIBLE_STATUSES = [...ADMIN_PUBLIC_STATUSES];
const REJECTED_STATUSES: readonly string[] = [
  MODERATION_STATUS.MACHINE_REJECTED,
  MODERATION_STATUS.HUMAN_REJECTED,
];

export interface AdminReportRow {
  report_id: string;
  spot_id: string;
  user_id: string;
  content_type: string;
  content: string;
  images: string[];
  fish_key: string | null;
  catch_weight_kg: Prisma.Decimal | null;
  moderation_status: string;
  machine_result: Prisma.JsonValue | null;
  reject_reason: string | null;
  adopted_at: Date | null;
  adopted_by: string | null;
  auditor_id: string | null;
  audit_time: Date | null;
  like_count: number;
  created_at: Date;
  deleted_at: Date | null;
  spot: { spot_id: string; spot_name: string };
  user: {
    user_id: string;
    nickname: string | null;
    status: string;
    restricted_until: Date | null;
    created_at: Date;
  };
}

export interface AdminAbuseRow {
  abuse_id: string;
  report_id: string;
  user_id: string;
  reason: string;
  status: string;
  handled_by: string | null;
  handled_at: Date | null;
  created_at: Date;
  report: {
    report_id: string;
    spot_id: string;
    user_id: string;
    content_type: string;
    content: string;
    images: string[];
    moderation_status: string;
    deleted_at: Date | null;
    spot: { spot_id: string; spot_name: string };
  };
}

export interface AdminReportAuditRow {
  log_id: string;
  action: string;
  admin_id: string;
  before_json: Prisma.JsonValue | null;
  after_json: Prisma.JsonValue | null;
  created_at: Date;
}

export interface AdminReportAbuseRow {
  abuse_id: string;
  reason: string;
  status: string;
  created_at: Date;
  handled_at: Date | null;
}

export interface AdminAppUserRow {
  user_id: string;
  status: string;
  token_version: number;
  restricted_until: Date | null;
  deleted_at: Date | null;
}

export interface AdminQueueCursor {
  createdAt: Date;
  id: string;
}

export interface AdminSlaFilter {
  cutoff: Date;
  overdue: boolean;
}

export interface AdminReportListParams {
  statuses: readonly string[];
  contentType?: string;
  spotId?: string;
  spotName?: string;
  slaFilter?: AdminSlaFilter;
  cursor: AdminQueueCursor | null;
  limit: number;
}

export interface AdminReportListResult {
  rows: AdminReportRow[];
  total: number;
  hasMore: boolean;
}

export interface AdminAbuseListParams {
  status: string;
  spotName?: string;
  slaFilter?: AdminSlaFilter;
  cursor: AdminQueueCursor | null;
  limit: number;
}

export interface AdminAbuseListResult {
  rows: AdminAbuseRow[];
  total: number;
  hasMore: boolean;
}

export interface AdminSummaryCounts {
  spot_check: number;
  pending: number;
  rejected: number;
  removed: number;
  abuse_pending: number;
  media_check_unfinished: number;
  sla_overdue: number;
}

export interface RemovedReportImages {
  report_id: string;
  images: string[];
}

export type BanUserResult =
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: string }
  | {
      kind: 'banned';
      before: { status: string; restricted_until: Date | null };
      removed_reports: RemovedReportImages[];
    };

export type UnbanUserResult =
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: string }
  | { kind: 'unbanned' };

export interface AbuseRemoveResult {
  report_id: string;
  images: string[];
  report_status_before: string;
  report_status_after: string;
}

const ADMIN_REPORT_SELECT = {
  report_id: true,
  spot_id: true,
  user_id: true,
  content_type: true,
  content: true,
  images: true,
  fish_key: true,
  catch_weight_kg: true,
  moderation_status: true,
  machine_result: true,
  reject_reason: true,
  adopted_at: true,
  adopted_by: true,
  auditor_id: true,
  audit_time: true,
  like_count: true,
  created_at: true,
  deleted_at: true,
  spot: { select: { spot_id: true, spot_name: true } },
  user: {
    select: {
      user_id: true,
      nickname: true,
      status: true,
      restricted_until: true,
      created_at: true,
    },
  },
} satisfies Prisma.ReportSelect;

const ADMIN_ABUSE_SELECT = {
  abuse_id: true,
  report_id: true,
  user_id: true,
  reason: true,
  status: true,
  handled_by: true,
  handled_at: true,
  created_at: true,
  report: {
    select: {
      report_id: true,
      spot_id: true,
      user_id: true,
      content_type: true,
      content: true,
      images: true,
      moderation_status: true,
      deleted_at: true,
      spot: { select: { spot_id: true, spot_name: true } },
    },
  },
} satisfies Prisma.ReportAbuseSelect;

const MAX_CURSOR_LENGTH = 256;

/** Admin queue cursors are base64 of `created_at|id`, ascending order. */
export function encodeAdminCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64');
}

/** Returns null for malformed cursors so the service can answer 400. */
export function decodeAdminCursor(cursor: string): AdminQueueCursor | null {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    return null;
  }
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = raw.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  const age = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!isUlid(id)) {
    return null;
  }
  const createdAt = new Date(age);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== age) {
    return null;
  }
  return { createdAt, id };
}

/** Owns every Prisma query for the admin moderation module. */
@Injectable()
export class AdminReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findReport(reportId: string): Promise<AdminReportRow | null> {
    return this.prisma.report.findUnique({
      where: { report_id: reportId },
      select: ADMIN_REPORT_SELECT,
    });
  }

  async findModerationStatus(reportId: string): Promise<string | null> {
    const row = await this.prisma.report.findUnique({
      where: { report_id: reportId },
      select: { moderation_status: true, deleted_at: true },
    });
    if (row === null || row.deleted_at !== null) {
      return null;
    }
    return row.moderation_status;
  }

  async listReports(params: AdminReportListParams): Promise<AdminReportListResult> {
    const base: Prisma.ReportWhereInput = {
      deleted_at: null,
      moderation_status: { in: [...params.statuses] },
      ...(params.contentType === undefined ? {} : { content_type: params.contentType }),
      ...(params.spotId === undefined ? {} : { spot_id: params.spotId }),
      ...(params.spotName === undefined
        ? {}
        : {
            spot: {
              is: { spot_name: { contains: params.spotName, mode: 'insensitive' } },
            },
          }),
      ...(params.slaFilter === undefined
        ? {}
        : {
            created_at: params.slaFilter.overdue
              ? { lt: params.slaFilter.cutoff }
              : { gte: params.slaFilter.cutoff },
          }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where: withCursor(base, params.cursor),
        select: ADMIN_REPORT_SELECT,
        orderBy: [{ created_at: 'asc' }, { report_id: 'asc' }],
        take: params.limit + 1,
      }),
      this.prisma.report.count({ where: base }),
    ]);
    const hasMore = rows.length > params.limit;
    return { rows: hasMore ? rows.slice(0, params.limit) : rows, total, hasMore };
  }

  async summaryCounts(now: Date): Promise<AdminSummaryCounts> {
    const overdueCutoff = new Date(now.getTime() - ADMIN_SLA_HOURS * 60 * 60 * 1000);
    const [
      spotCheck,
      pending,
      rejected,
      removed,
      overdueSpotCheck,
      overduePending,
      abusePending,
      mediaCheckUnfinished,
    ] = await this.prisma.$transaction([
      this.prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.PUBLISHED },
      }),
      this.prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.MACHINE_PENDING },
      }),
      this.prisma.report.count({
        where: { deleted_at: null, moderation_status: { in: [...REJECTED_STATUSES] } },
      }),
      this.prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.REMOVED },
      }),
      this.prisma.report.count({
        where: {
          deleted_at: null,
          moderation_status: MODERATION_STATUS.PUBLISHED,
          created_at: { lt: overdueCutoff },
        },
      }),
      this.prisma.report.count({
        where: {
          deleted_at: null,
          moderation_status: MODERATION_STATUS.MACHINE_PENDING,
          created_at: { lt: overdueCutoff },
        },
      }),
      this.prisma.reportAbuse.count({ where: { status: 'pending' } }),
      this.prisma.reportMediaCheck.count({ where: { status: 'pending' } }),
    ]);
    return {
      spot_check: spotCheck,
      pending,
      rejected,
      removed,
      abuse_pending: abusePending,
      media_check_unfinished: mediaCheckUnfinished,
      sla_overdue: overdueSpotCheck + overduePending,
    };
  }

  /** All-time rejected counts for the page authors, keyed by user_id. */
  async authorRejectedCounts(userIds: readonly string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.report.groupBy({
      by: ['user_id'],
      where: {
        user_id: { in: [...userIds] },
        deleted_at: null,
        moderation_status: { in: [...REJECTED_STATUSES] },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.user_id, row._count._all]));
  }

  /** Pending abuse counts for the page reports, keyed by report_id. */
  async pendingAbuseCounts(reportIds: readonly string[]): Promise<Map<string, number>> {
    if (reportIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.reportAbuse.groupBy({
      by: ['report_id'],
      where: { report_id: { in: [...reportIds] }, status: 'pending' },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.report_id, row._count._all]));
  }

  /** Report scoped audit trail. Only structured before/after fields are selected. */
  listReportAudits(reportId: string): Promise<AdminReportAuditRow[]> {
    return this.prisma.auditLog.findMany({
      where: { entity_type: 'report', entity_id: reportId },
      select: {
        log_id: true,
        action: true,
        admin_id: true,
        before_json: true,
        after_json: true,
        created_at: true,
      },
      orderBy: [{ created_at: 'desc' }, { log_id: 'desc' }],
    });
  }

  /** Per-report abuse rows. Reporter user_id is deliberately not selected. */
  listReportAbuses(reportId: string): Promise<AdminReportAbuseRow[]> {
    return this.prisma.reportAbuse.findMany({
      where: { report_id: reportId },
      select: {
        abuse_id: true,
        reason: true,
        status: true,
        created_at: true,
        handled_at: true,
      },
      orderBy: [{ created_at: 'desc' }, { abuse_id: 'desc' }],
    });
  }

  findAbuse(abuseId: string): Promise<AdminAbuseRow | null> {
    return this.prisma.reportAbuse.findUnique({
      where: { abuse_id: abuseId },
      select: ADMIN_ABUSE_SELECT,
    });
  }

  async listAbuses(params: AdminAbuseListParams): Promise<AdminAbuseListResult> {
    const base: Prisma.ReportAbuseWhereInput = {
      status: params.status,
      ...(params.spotName === undefined
        ? {}
        : {
            report: {
              is: {
                spot: {
                  is: { spot_name: { contains: params.spotName, mode: 'insensitive' } },
                },
              },
            },
          }),
      ...(params.slaFilter === undefined
        ? {}
        : {
            created_at: params.slaFilter.overdue
              ? { lt: params.slaFilter.cutoff }
              : { gte: params.slaFilter.cutoff },
          }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reportAbuse.findMany({
        where: withAbuseCursor(base, params.cursor),
        select: ADMIN_ABUSE_SELECT,
        orderBy: [{ created_at: 'asc' }, { abuse_id: 'asc' }],
        take: params.limit + 1,
      }),
      this.prisma.reportAbuse.count({ where: base }),
    ]);
    const hasMore = rows.length > params.limit;
    return { rows: hasMore ? rows.slice(0, params.limit) : rows, total, hasMore };
  }

  /**
   * Conditional transition from published/machine_pending to human_approved,
   * cancelling pending media checks in the same transaction. A concurrent human
   * decision or media callback makes the update affect zero rows.
   */
  approveReport(reportId: string, adminId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        where: {
          report_id: reportId,
          deleted_at: null,
          moderation_status: {
            in: [MODERATION_STATUS.PUBLISHED, MODERATION_STATUS.MACHINE_PENDING],
          },
        },
        data: {
          moderation_status: MODERATION_STATUS.HUMAN_APPROVED,
          reject_reason: null,
          auditor_id: adminId,
          audit_time: now,
        },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.reportMediaCheck.updateMany({
        where: { report_id: reportId, status: 'pending' },
        data: { status: 'canceled', checked_at: now },
      });
      return true;
    });
  }

  rejectReport(reportId: string, adminId: string, now: Date, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        where: {
          report_id: reportId,
          deleted_at: null,
          moderation_status: {
            in: [MODERATION_STATUS.PUBLISHED, MODERATION_STATUS.MACHINE_PENDING],
          },
        },
        data: {
          moderation_status: MODERATION_STATUS.HUMAN_REJECTED,
          reject_reason: reason,
          auditor_id: adminId,
          audit_time: now,
        },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.reportMediaCheck.updateMany({
        where: { report_id: reportId, status: 'pending' },
        data: { status: 'canceled', checked_at: now },
      });
      return true;
    });
  }

  removeReport(reportId: string, adminId: string, now: Date, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        where: {
          report_id: reportId,
          deleted_at: null,
          moderation_status: { in: [...VISIBLE_STATUSES] },
        },
        data: {
          moderation_status: MODERATION_STATUS.REMOVED,
          reject_reason: reason,
          auditor_id: adminId,
          audit_time: now,
        },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.reportMediaCheck.updateMany({
        where: { report_id: reportId, status: 'pending' },
        data: { status: 'canceled', checked_at: now },
      });
      return true;
    });
  }

  async adoptReport(reportId: string, adminId: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.report.updateMany({
      where: {
        report_id: reportId,
        deleted_at: null,
        content_type: 'intel',
        moderation_status: { in: [...VISIBLE_STATUSES] },
      },
      data: { adopted_at: now, adopted_by: adminId },
    });
    return updated.count > 0;
  }

  async dismissAbuse(abuseId: string, adminId: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.reportAbuse.updateMany({
      where: { abuse_id: abuseId, status: 'pending' },
      data: { status: 'dismissed', handled_by: adminId, handled_at: now },
    });
    return updated.count > 0;
  }

  /**
   * Marks every pending abuse of the report removed and takes the content down
   * when it is still publicly visible. The report transition is conditional, so
   * a concurrent approve/remove keeps its own outcome.
   */
  removeAbuse(
    abuseId: string,
    adminId: string,
    now: Date,
    reason: string,
  ): Promise<AbuseRemoveResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const abuse = await tx.reportAbuse.findUnique({
        where: { abuse_id: abuseId },
        select: {
          abuse_id: true,
          status: true,
          report_id: true,
          report: {
            select: { images: true, moderation_status: true, deleted_at: true },
          },
        },
      });
      if (abuse === null || abuse.status !== 'pending') {
        return null;
      }
      await tx.reportAbuse.updateMany({
        where: { report_id: abuse.report_id, status: 'pending' },
        data: { status: 'removed', handled_by: adminId, handled_at: now },
      });

      let statusAfter = abuse.report.moderation_status;
      if (
        abuse.report.deleted_at === null &&
        VISIBLE_STATUSES.includes(abuse.report.moderation_status)
      ) {
        const updated = await tx.report.updateMany({
          where: {
            report_id: abuse.report_id,
            deleted_at: null,
            moderation_status: { in: [...VISIBLE_STATUSES] },
          },
          data: {
            moderation_status: MODERATION_STATUS.REMOVED,
            reject_reason: reason,
            auditor_id: adminId,
            audit_time: now,
          },
        });
        if (updated.count > 0) {
          statusAfter = MODERATION_STATUS.REMOVED;
          await tx.reportMediaCheck.updateMany({
            where: { report_id: abuse.report_id, status: 'pending' },
            data: { status: 'canceled', checked_at: now },
          });
        }
      }
      return {
        report_id: abuse.report_id,
        images: abuse.report.images,
        report_status_before: abuse.report.moderation_status,
        report_status_after: statusAfter,
      };
    });
  }

  findAppUser(userId: string): Promise<AdminAppUserRow | null> {
    return this.prisma.appUser.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        status: true,
        token_version: true,
        restricted_until: true,
        deleted_at: true,
      },
    });
  }

  async setRestrictedUntil(userId: string, value: Date | null): Promise<void> {
    await this.prisma.appUser.update({
      where: { user_id: userId },
      data: { restricted_until: value },
    });
  }

  /**
   * Bans the user, clears any restriction, revokes every session and takes down
   * all visible content in one transaction. Images are returned for best-effort
   * deletion after commit; `report.images` keeps the purge-job retry pointer.
   */
  banUser(userId: string, adminId: string, now: Date): Promise<BanUserResult> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({
        where: { user_id: userId },
        select: {
          user_id: true,
          status: true,
          token_version: true,
          restricted_until: true,
          deleted_at: true,
        },
      });
      if (user === null || user.deleted_at !== null) {
        return { kind: 'not_found' };
      }
      if (user.status === 'banned') {
        return { kind: 'conflict', status: user.status };
      }

      // Conditional update so two concurrent bans cannot increment
      // token_version or revoke sessions twice.
      const banned = await tx.appUser.updateMany({
        where: { user_id: userId, deleted_at: null, status: { not: 'banned' } },
        data: {
          status: 'banned',
          restricted_until: null,
          token_version: { increment: 1 },
        },
      });
      if (banned.count === 0) {
        return { kind: 'conflict', status: 'banned' };
      }

      const visible = await tx.report.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          moderation_status: { in: [...VISIBLE_STATUSES] },
        },
        select: { report_id: true, images: true },
      });

      await tx.userSession.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now },
      });

      if (visible.length > 0) {
        const reportIds = visible.map((row) => row.report_id);
        await tx.report.updateMany({
          where: { report_id: { in: reportIds }, deleted_at: null },
          data: {
            moderation_status: MODERATION_STATUS.REMOVED,
            reject_reason: 'user_banned',
            auditor_id: adminId,
            audit_time: now,
          },
        });
        await tx.reportMediaCheck.updateMany({
          where: { report_id: { in: reportIds }, status: 'pending' },
          data: { status: 'canceled', checked_at: now },
        });
      }

      return {
        kind: 'banned',
        before: { status: user.status, restricted_until: user.restricted_until },
        removed_reports: visible,
      };
    });
  }

  /** Unban never restores content; `token_version` moves again to retire old tokens. */
  unbanUser(userId: string): Promise<UnbanUserResult> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({
        where: { user_id: userId },
        select: { user_id: true, status: true, deleted_at: true },
      });
      if (user === null || user.deleted_at !== null) {
        return { kind: 'not_found' };
      }
      if (user.status !== 'banned') {
        return { kind: 'conflict', status: user.status };
      }
      const activated = await tx.appUser.updateMany({
        where: { user_id: userId, deleted_at: null, status: 'banned' },
        data: { status: 'active', token_version: { increment: 1 } },
      });
      if (activated.count === 0) {
        return { kind: 'conflict', status: 'banned' };
      }
      return { kind: 'unbanned' };
    });
  }
}

function withCursor(
  base: Prisma.ReportWhereInput,
  cursor: AdminQueueCursor | null,
): Prisma.ReportWhereInput {
  if (cursor === null) {
    return base;
  }
  return {
    ...base,
    OR: [
      { created_at: { gt: cursor.createdAt } },
      { created_at: cursor.createdAt, report_id: { gt: cursor.id } },
    ],
  };
}

function withAbuseCursor(
  base: Prisma.ReportAbuseWhereInput,
  cursor: AdminQueueCursor | null,
): Prisma.ReportAbuseWhereInput {
  if (cursor === null) {
    return base;
  }
  return {
    ...base,
    OR: [
      { created_at: { gt: cursor.createdAt } },
      { created_at: cursor.createdAt, abuse_id: { gt: cursor.id } },
    ],
  };
}
