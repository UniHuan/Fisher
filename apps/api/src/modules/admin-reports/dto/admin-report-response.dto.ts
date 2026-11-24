import { ApiProperty } from '@nestjs/swagger';
import { ABUSE_REASON, MODERATION_STATUS, REPORT_CONTENT_TYPE } from '@szfisher/shared';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);
const MODERATION_STATUSES: readonly string[] = Object.values(MODERATION_STATUS);
const ABUSE_REASONS: readonly string[] = Object.values(ABUSE_REASON);

export class AdminReportAuthorDto {
  @ApiProperty({ example: '01HX0000000000000000000001' })
  user_id!: string;

  @ApiProperty({ type: String, nullable: true, example: '钓友 A7K2' })
  nickname!: string | null;

  @ApiProperty({ example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  restricted_until!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({
    type: 'integer',
    example: 2,
    description: 'All-time count of machine or human rejected content by this author',
  })
  rejected_count!: number;
}

export class AdminReportItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园' })
  spot_name!: string;

  @ApiProperty({ enum: CONTENT_TYPES, example: 'comment' })
  content_type!: string;

  @ApiProperty({ example: '今天鱼口不错，停车位充足。' })
  content!: string;

  @ApiProperty({
    type: [String],
    description:
      'Public paths for visible content; signed work-bucket preview URLs for pending or removed content',
    example: ['/api/v1/uploads/public/ugc/01HX0000000000000000000000/01HX0000000000000000000001.webp'],
  })
  images!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'luofei' })
  fish_key!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2.50' })
  catch_weight_kg!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'open' })
  condition_open_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'free' })
  condition_fee_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'low' })
  condition_crowd_level!: string | null;

  @ApiProperty({ type: [String], example: ['toilet', 'parking'] })
  condition_facilities!: string[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  observed_at!: string | null;

  @ApiProperty({ enum: MODERATION_STATUSES, example: 'published' })
  moderation_status!: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    nullable: true,
    description: 'Machine review conclusion, label and trace id only',
  })
  machine_result!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  reject_reason!: string | null;

  @ApiProperty({ type: 'integer', example: 18 })
  like_count!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Pending abuse reports against this content',
  })
  abuse_count!: number;

  @ApiProperty({ example: false })
  is_adopted!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  audit_time!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  auditor_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  adopted_at!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  adopted_by!: string | null;

  @ApiProperty({
    type: 'number',
    example: 25.4,
    description: 'Hours since creation, used for the 24-hour human review SLA',
  })
  age_hours!: number;

  @ApiProperty({ example: true, description: 'True when age_hours exceeds 24' })
  sla_overdue!: boolean;

  @ApiProperty({ type: () => AdminReportAuthorDto })
  author!: AdminReportAuthorDto;
}

export class AdminReportPageDto {
  @ApiProperty({ type: () => [AdminReportItemDto] })
  items!: AdminReportItemDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: 'integer', example: 12 })
  total!: number;
}

export class AdminReportSummaryDto {
  @ApiProperty({ type: 'integer', example: 12, description: 'published waiting for spot check' })
  spot_check!: number;

  @ApiProperty({ type: 'integer', example: 3, description: 'machine_pending needing human review' })
  pending!: number;

  @ApiProperty({ type: 'integer', example: 4 })
  rejected!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  removed!: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Pending abuse reports for the nav badge' })
  abuse_pending!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Media checks not yet in a terminal state' })
  media_check_unfinished!: number;

  @ApiProperty({
    type: 'integer',
    example: 2,
    description: 'Spot-check plus pending items older than 24 hours',
  })
  sla_overdue!: number;
}

export class AdminReportAuditItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  log_id!: string;

  @ApiProperty({ example: 'report.approve' })
  action!: string;

  @ApiProperty({ type: String, nullable: true, example: 'published' })
  status_before!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'human_approved' })
  status_after!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  reason!: string | null;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  admin_id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class AdminReportHistoryAbuseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  abuse_id!: string;

  @ApiProperty({ enum: ABUSE_REASONS, example: 'ad' })
  reason!: string;

  @ApiProperty({ enum: ['pending', 'removed', 'dismissed'], example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  handled_at!: string | null;
}

export class AdminReportHistoryDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({
    type: () => [AdminReportAuditItemDto],
    description: 'Report scoped audit actions, newest first; no content or image payloads',
  })
  audit!: AdminReportAuditItemDto[];

  @ApiProperty({
    type: () => [AdminReportHistoryAbuseDto],
    description: 'Abuse reports for this content; reporter identity is never returned',
  })
  abuses!: AdminReportHistoryAbuseDto[];
}

export class AdminReportActionDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({ enum: MODERATION_STATUSES, example: 'human_approved' })
  moderation_status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  adopted_at!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  adopted_by!: string | null;
}

export class AdminAbuseReportSummaryDto {
  @ApiProperty({ example: '01HX0000000000000000000001' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园' })
  spot_name!: string;

  @ApiProperty({ enum: CONTENT_TYPES, example: 'comment' })
  content_type!: string;

  @ApiProperty({ example: '今天鱼口不错' })
  content!: string;

  @ApiProperty({ enum: MODERATION_STATUSES, example: 'published' })
  moderation_status!: string;

  @ApiProperty({ type: [String] })
  images!: string[];
}

export class AdminAbuseItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  abuse_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  report_id!: string;

  @ApiProperty({ enum: ABUSE_REASONS, example: 'ad' })
  reason!: string;

  @ApiProperty({ enum: ['pending', 'removed', 'dismissed'], example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  handled_at!: string | null;

  @ApiProperty({ type: 'number', example: 25.4 })
  age_hours!: number;

  @ApiProperty({ example: true })
  sla_overdue!: boolean;

  @ApiProperty({ type: () => AdminAbuseReportSummaryDto })
  report!: AdminAbuseReportSummaryDto;
}

export class AdminAbusePageDto {
  @ApiProperty({ type: () => [AdminAbuseItemDto] })
  items!: AdminAbuseItemDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: 'integer', example: 4 })
  total!: number;
}

export class AdminAbuseHandleResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  abuse_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  report_id!: string;

  @ApiProperty({ enum: ['removed', 'dismissed'], example: 'removed' })
  status!: string;

  @ApiProperty({ enum: MODERATION_STATUSES, example: 'removed' })
  moderation_status!: string;
}

export class AdminUserRestrictResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  user_id!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  restricted_until!: string | null;
}

export class AdminUserBanResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  user_id!: string;

  @ApiProperty({ enum: ['banned', 'active'], example: 'banned' })
  status!: string;
}
