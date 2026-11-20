import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, OPEN_STATUS, SPOT_STATUS, UGC_UPLOAD_STATUS } from '@szfisher/shared';
import type { Prisma, Report, Spot } from '@prisma/client';
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
