import { ApiPropertyOptional } from '@nestjs/swagger';
import { ABUSE_STATUS, REPORT_CONTENT_TYPE } from '@szfisher/shared';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function toBoolean({ value }: TransformFnParams): unknown {
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === '0') {
    return false;
  }
  return value;
}

export const ADMIN_REPORT_QUEUES = [
  'spot_check',
  'pending',
  'rejected',
  'removed',
] as const;

export type AdminReportQueue = (typeof ADMIN_REPORT_QUEUES)[number];

export const ADMIN_ABUSE_STATUSES = [
  ABUSE_STATUS.PENDING,
  ABUSE_STATUS.REMOVED,
  ABUSE_STATUS.DISMISSED,
] as const;

export type AdminAbuseStatus = (typeof ADMIN_ABUSE_STATUSES)[number];

export class AdminReportListQueryDto {
  @ApiPropertyOptional({
    enum: ADMIN_REPORT_QUEUES,
    default: 'spot_check',
    description:
      'spot_check=published; pending=machine_pending; rejected=machine_rejected/human_rejected; removed=removed',
  })
  @IsOptional()
  @IsIn(ADMIN_REPORT_QUEUES)
  queue?: AdminReportQueue;

  @ApiPropertyOptional({ enum: Object.values(REPORT_CONTENT_TYPE), example: 'comment' })
  @IsOptional()
  @IsIn(Object.values(REPORT_CONTENT_TYPE))
  content_type?: string;

  @ApiPropertyOptional({ description: 'Spot ULID filter', minLength: 26, maxLength: 26 })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  spot_id?: string;

  @ApiPropertyOptional({
    description: 'Partial, case-insensitive spot name filter applied before pagination',
    minLength: 1,
    maxLength: 60,
    example: '深圳湾',
  })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  spot_name?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only rows older than the 24-hour SLA, applied before pagination so totals match',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sla_overdue?: boolean;

  @ApiPropertyOptional({
    description: 'Opaque cursor: base64(created_at|report_id)',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AdminAbuseListQueryDto {
  @ApiPropertyOptional({
    enum: ADMIN_ABUSE_STATUSES,
    default: ABUSE_STATUS.PENDING,
    description: 'Abuse report handling status',
  })
  @IsOptional()
  @IsIn(ADMIN_ABUSE_STATUSES)
  status?: AdminAbuseStatus;

  @ApiPropertyOptional({
    description: 'Partial, case-insensitive spot name filter applied before pagination',
    minLength: 1,
    maxLength: 60,
    example: '深圳湾',
  })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  spot_name?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only abuse reports older than the 24-hour SLA, applied before pagination so totals match',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sla_overdue?: boolean;

  @ApiPropertyOptional({
    description: 'Opaque cursor: base64(created_at|abuse_id)',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
