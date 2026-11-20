import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  MODERATION_STATUS,
  OPEN_STATUS,
  SPOT_STATUS,
  UGC_UPLOAD_STATUS,
} from '@szfisher/shared';
import { Prisma } from '@prisma/client';
import type { Report, Spot } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportCursor } from './report-cursor';
import type { MyReportRow, PublicReportRow } from './report.mapper';

export type SpotVisibility = Pick<
  Spot,
  'spot_id' | 'status' | 'open_status' | 'deleted_at'
>;

export interface ReportAuthorView {
  user_id: string;
  status: string;
  deleted_at: Date | null;
  restricted_until: Date | null;
  created_at: Date;
  terms_version: string | null;
  terms_accepted_at: Date | null;
}

export interface CreateReportRowInput {
  reportId: string;
  spotId: string;
  userId: string;
  contentType: string;
  content: string;
  fishKey: string | null;
  catchWeightKg: number | null;
  /** Millisecond-precision write time; keeps the pagination cursor exact. */
  createdAt: Date;
  terms: { version: string; acceptedAt: Date } | null;
  /** Owned pending UgcUpload keys, already deduplicated by the service. */
  imageKeys: string[];
  usedAt: Date;
}

export interface PublicListParams {
  spotId: string;
  contentType: string | undefined;
  statuses: readonly string[];
  cursor: ReportCursor | null;
  limit: number;
  viewerId: string | undefined;
}

export interface MyListParams {
  userId: string;
  statuses: readonly string[] | null;
  cursor: ReportCursor | null;
  limit: number;
}

export interface ActionReportView {
  report_id: string;
  user_id: string;
  images: string[];
  moderation_status: string;
  deleted_at: Date | null;
  spot: SpotVisibility;
}

export interface CreateAbuseInput {
  abuseId: string;
  reportId: string;
  userId: string;
  reason: string;
  createdAt: Date;
}

const REPORT_ORDER: Prisma.ReportOrderByWithRelationInput[] = [
  { created_at: 'desc' },
  { report_id: 'desc' },
];

/** Owns every Prisma query for the report domain. */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUser(userId: string): Promise<ReportAuthorView | null> {
    return this.prisma.appUser.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        status: true,
        deleted_at: true,
        restricted_until: true,
        created_at: true,
        terms_version: true,
        terms_accepted_at: true,
      },
    });
  }

  findSpotVisibility(spotId: string): Promise<SpotVisibility | null> {
    return this.prisma.spot.findUnique({
      where: { spot_id: spotId },
      select: { spot_id: true, status: true, open_status: true, deleted_at: true },
    });
  }

  /**
   * Creates the report, marks its uploads used and records first-time terms
   * acceptance in one transaction. If any upload stopped being an owned pending
   * row between validation and here, the whole insert rolls back.
   */
  createReport(input: CreateReportRowInput): Promise<Report> {
    return this.prisma.$transaction(async (tx) => {
      if (input.imageKeys.length > 0) {
        const claimed = await tx.ugcUpload.updateMany({
          where: {
            user_id: input.userId,
            object_key: { in: input.imageKeys },
            status: UGC_UPLOAD_STATUS.PENDING,
            deleted_at: null,
          },
          data: { status: UGC_UPLOAD_STATUS.USED, used_at: input.usedAt },
        });
        if (claimed.count !== input.imageKeys.length) {
          throw new AppError(
            ERROR_CODES.VALIDATION,
            HttpStatus.BAD_REQUEST,
            'Image keys must be pending uploads owned by the current user',
          );
        }
      }
      if (input.terms !== null) {
        await tx.appUser.update({
          where: { user_id: input.userId },
          data: {
            terms_version: input.terms.version,
            terms_accepted_at: input.terms.acceptedAt,
          },
        });
      }
      return tx.report.create({
        data: {
          report_id: input.reportId,
          spot_id: input.spotId,
          user_id: input.userId,
          content_type: input.contentType,
          content: input.content,
          images: input.imageKeys,
          fish_key: input.fishKey,
          catch_weight_kg: input.catchWeightKg,
          // Explicit ms-precision value instead of the microsecond-precision
          // database default, so the cursors can use exact timestamp equality.
          created_at: input.createdAt,
        },
      });
    });
  }

  async findPendingUploadKeys(userId: string, keys: string[]): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }
    const rows = await this.prisma.ugcUpload.findMany({
      where: {
        user_id: userId,
        object_key: { in: keys },
        status: UGC_UPLOAD_STATUS.PENDING,
        deleted_at: null,
      },
      select: { object_key: true },
    });
    return rows.map((row) => row.object_key);
  }

  async findModerationStatus(reportId: string): Promise<string | null> {
    const row = await this.prisma.report.findUnique({
      where: { report_id: reportId },
      select: { moderation_status: true },
    });
    return row?.moderation_status ?? null;
  }

  updateModeration(
    reportId: string,
    moderationStatus: string,
    machineResult: Prisma.InputJsonValue,
  ): Promise<Report> {
    return this.prisma.report.update({
      where: { report_id: reportId },
      data: {
        moderation_status: moderationStatus,
        machine_result: machineResult,
      },
    });
  }

  findActionReport(reportId: string): Promise<ActionReportView | null> {
    return this.prisma.report.findUnique({
      where: { report_id: reportId },
      select: {
        report_id: true,
        user_id: true,
        images: true,
        moderation_status: true,
        deleted_at: true,
        spot: {
          select: { spot_id: true, status: true, open_status: true, deleted_at: true },
        },
      },
    });
  }

  /**
   * Idempotent like. The insert only succeeds while the content is publicly
   * visible, and the cached count moves in the same transaction, so concurrent
   * or repeated likes can never double-count.
   */
  likeReport(
    reportId: string,
    userId: string,
    visibleStatuses: readonly string[],
  ): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO report_like (report_id, user_id)
        SELECT ${reportId}, ${userId}
        WHERE EXISTS (
          SELECT 1
          FROM report r
          JOIN spot s ON s.spot_id = r.spot_id
          WHERE r.report_id = ${reportId}
            AND r.deleted_at IS NULL
            AND r.moderation_status IN (${Prisma.join(visibleStatuses)})
            AND s.status = ${SPOT_STATUS.PUBLISHED}
            AND s.deleted_at IS NULL
            AND (s.open_status IS NULL OR s.open_status <> ${OPEN_STATUS.BANNED})
        )
        ON CONFLICT (report_id, user_id) DO NOTHING
      `;
      if (inserted > 0) {
        await tx.report.update({
          where: { report_id: reportId },
          data: { like_count: { increment: 1 } },
        });
      }
      const row = await tx.report.findUnique({
        where: { report_id: reportId },
        select: { like_count: true, moderation_status: true, deleted_at: true },
      });
      if (
        row === null ||
        row.deleted_at !== null ||
        !visibleStatuses.includes(row.moderation_status)
      ) {
        return null;
      }
      return row.like_count;
    });
  }

  /** Idempotent unlike; the count never drops below zero. */
  unlikeReport(reportId: string, userId: string): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.$executeRaw`
        DELETE FROM report_like
        WHERE report_id = ${reportId} AND user_id = ${userId}
      `;
      if (removed > 0) {
        await tx.$executeRaw`
          UPDATE report
          SET like_count = GREATEST(like_count - 1, 0)
          WHERE report_id = ${reportId}
        `;
      }
      const row = await tx.report.findUnique({
        where: { report_id: reportId },
        select: { like_count: true },
      });
      return row?.like_count ?? null;
    });
  }

  /** The unique (report_id, user_id) index turns a repeat report into a no-op. */
  async createAbuse(input: CreateAbuseInput): Promise<void> {
    await this.prisma.reportAbuse.createMany({
      data: [
        {
          abuse_id: input.abuseId,
          report_id: input.reportId,
          user_id: input.userId,
          reason: input.reason,
          created_at: input.createdAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * Author deletion: clear the content, mark the uploads deleted and cancel any
   * pending media checks in one transaction. Returns false when another request
   * already deleted the report, so the caller can answer 404.
   */
  markAuthorDeleted(reportId: string, imageKeys: string[], now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        where: { report_id: reportId, deleted_at: null },
        data: {
          deleted_at: now,
          moderation_status: MODERATION_STATUS.REMOVED,
          reject_reason: 'author_deleted',
          content: '',
          images: [],
          fish_key: null,
          catch_weight_kg: null,
        },
      });
      if (updated.count === 0) {
        return false;
      }
      if (imageKeys.length > 0) {
        await tx.ugcUpload.updateMany({
          where: {
            object_key: { in: imageKeys },
            status: { not: UGC_UPLOAD_STATUS.DELETED },
          },
          data: { status: UGC_UPLOAD_STATUS.DELETED, deleted_at: now },
        });
      }
      await tx.reportMediaCheck.updateMany({
        where: { report_id: reportId, status: 'pending' },
        data: { status: 'canceled', checked_at: now },
      });
      return true;
    });
  }

  async listPublic(params: PublicListParams): Promise<{
    rows: PublicReportRow[];
    total: number;
    likedReportIds: Set<string>;
    hasMore: boolean;
  }> {
    const base: Prisma.ReportWhereInput = {
      spot_id: params.spotId,
      deleted_at: null,
      moderation_status: { in: [...params.statuses] },
      // Defense in depth: a spot banned between the service check and this
      // query must not leak its content. NULL open_status means not banned.
      spot: {
        is: {
          status: SPOT_STATUS.PUBLISHED,
          deleted_at: null,
          OR: [{ open_status: null }, { open_status: { not: OPEN_STATUS.BANNED } }],
        },
      },
      ...(params.contentType === undefined ? {} : { content_type: params.contentType }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where: withCursor(base, params.cursor),
        include: { user: { select: { nickname: true, avatar_url: true } } },
        orderBy: REPORT_ORDER,
        take: params.limit + 1,
      }),
      this.prisma.report.count({ where: base }),
    ]);
    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const likedReportIds = await this.findLikedReportIds(
      params.viewerId,
      pageRows.map((row) => row.report_id),
    );
    return { rows: pageRows, total, likedReportIds, hasMore };
  }

  async listMine(params: MyListParams): Promise<{
    rows: MyReportRow[];
    total: number;
    hasMore: boolean;
  }> {
    const base: Prisma.ReportWhereInput = {
      user_id: params.userId,
      deleted_at: null,
      ...(params.statuses === null
        ? {}
        : { moderation_status: { in: [...params.statuses] } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where: withCursor(base, params.cursor),
        include: {
          spot: {
            select: {
              spot_id: true,
              spot_name: true,
              open_status: true,
              status: true,
              deleted_at: true,
            },
          },
        },
        orderBy: REPORT_ORDER,
        take: params.limit + 1,
      }),
      this.prisma.report.count({ where: base }),
    ]);
    const hasMore = rows.length > params.limit;
    return {
      rows: hasMore ? rows.slice(0, params.limit) : rows,
      total,
      hasMore,
    };
  }

  private async findLikedReportIds(
    viewerId: string | undefined,
    reportIds: string[],
  ): Promise<Set<string>> {
    if (viewerId === undefined || reportIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.reportLike.findMany({
      where: { user_id: viewerId, report_id: { in: reportIds } },
      select: { report_id: true },
    });
    return new Set(rows.map((row) => row.report_id));
  }
}

/**
 * Keyset pagination: strictly older than the cursor, ULID as the tie-breaker.
 * Every report row is written with an explicit millisecond-precision
 * `created_at` (ReportsService captures the Date once), so exact timestamp
 * equality is valid and rows sharing a millisecond page by descending ULID.
 */
function withCursor(
  base: Prisma.ReportWhereInput,
  cursor: ReportCursor | null,
): Prisma.ReportWhereInput {
  if (cursor === null) {
    return base;
  }
  return {
    ...base,
    OR: [
      { created_at: { lt: cursor.createdAt } },
      { created_at: cursor.createdAt, report_id: { lt: cursor.reportId } },
    ],
  };
}
