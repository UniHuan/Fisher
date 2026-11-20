import { MODERATION_STATUS, OPEN_STATUS, SPOT_STATUS } from '@szfisher/shared';
import type { AppUser, Report, Spot } from '@prisma/client';
import type { MyReportItemDto } from './dto/my-report-response.dto';
import type { PublicReportItemDto } from './dto/public-report-response.dto';

const PUBLIC_UGC_IMAGE_PREFIX = '/api/v1/uploads/public/ugc';

export type PublicReportRow = Report & {
  user: Pick<AppUser, 'nickname' | 'avatar_url'>;
};

export type MyReportRow = Report & {
  spot: Pick<Spot, 'spot_id' | 'spot_name' | 'open_status' | 'status' | 'deleted_at'>;
};

export type SpotVisibility = Pick<Spot, 'status' | 'open_status' | 'deleted_at'>;

/** Published content images are served from the public UGC route (Task 8). */
export function publicReportImages(reportId: string, images: string[]): string[] {
  return images.map((key) => {
    const basename = key.split('/').pop() ?? '';
    return `${PUBLIC_UGC_IMAGE_PREFIX}/${reportId}/${basename}`;
  });
}

/** A spot detail page can open unless it is offline, deleted or banned. */
export function canOpenSpot(spot: SpotVisibility): boolean {
  return (
    spot.status === SPOT_STATUS.PUBLISHED &&
    spot.deleted_at === null &&
    spot.open_status !== OPEN_STATUS.BANNED
  );
}

export function isPubliclyVisibleStatus(status: string): boolean {
  return (
    status === MODERATION_STATUS.PUBLISHED || status === MODERATION_STATUS.HUMAN_APPROVED
  );
}

/** Likes and abuse reports are only accepted on content a visitor could read. */
export function isPublicReportVisible(
  report: { moderation_status: string; deleted_at: Date | null },
  spot: SpotVisibility | null,
): boolean {
  return (
    report.deleted_at === null &&
    isPubliclyVisibleStatus(report.moderation_status) &&
    spot !== null &&
    canOpenSpot(spot)
  );
}

export function toPublicReportItem(
  row: PublicReportRow,
  viewerId: string | undefined,
  likedReportIds: ReadonlySet<string>,
): PublicReportItemDto {
  return {
    report_id: row.report_id,
    spot_id: row.spot_id,
    content_type: row.content_type,
    content: row.content,
    images: publicReportImages(row.report_id, row.images),
    fish_key: row.fish_key,
    catch_weight_kg: row.catch_weight_kg === null ? null : row.catch_weight_kg.toFixed(2),
    created_at: row.created_at.toISOString(),
    like_count: row.like_count,
    liked_by_me: viewerId !== undefined && likedReportIds.has(row.report_id),
    is_mine: viewerId !== undefined && viewerId === row.user_id,
    is_adopted: row.adopted_at !== null,
    author: {
      nickname: row.user.nickname,
      avatar_url: row.user.avatar_url,
    },
  };
}

/**
 * Author-only view. Public rows expose the cacheable public route; pending,
 * rejected and removed rows expose short-lived signed work-bucket previews so
 * the author can still see what they submitted.
 */
export function toMyReportItem(
  row: MyReportRow,
  previewUrlFor?: (key: string) => string,
): MyReportItemDto {
  return {
    report_id: row.report_id,
    content_type: row.content_type,
    content: row.content,
    images: isPubliclyVisibleStatus(row.moderation_status)
      ? publicReportImages(row.report_id, row.images)
      : previewUrlFor === undefined
        ? []
        : row.images.map(previewUrlFor),
    moderation_status: row.moderation_status,
    reject_reason: row.reject_reason,
    created_at: row.created_at.toISOString(),
    audit_time: row.audit_time === null ? null : row.audit_time.toISOString(),
    spot: {
      spot_id: row.spot.spot_id,
      spot_name: row.spot.spot_name,
      open_status: row.spot.open_status,
      can_open: canOpenSpot(row.spot),
    },
  };
}
