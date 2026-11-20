import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MY_REPORT_STATUS_FILTERS = [
  'all',
  'pending',
  'published',
  'rejected',
  'removed',
] as const;

export type MyReportStatusFilter = (typeof MY_REPORT_STATUS_FILTERS)[number];

export class MyReportListQueryDto {
  @ApiPropertyOptional({
    enum: MY_REPORT_STATUS_FILTERS,
    default: 'all',
    description:
      'pending=machine_pending; published=published/human_approved; rejected=machine_rejected/human_rejected; removed=admin removal',
  })
  @IsOptional()
  @IsIn(MY_REPORT_STATUS_FILTERS)
  status?: MyReportStatusFilter;

  @ApiPropertyOptional({
    description: 'Opaque cursor: base64(created_at|report_id)',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 20, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
