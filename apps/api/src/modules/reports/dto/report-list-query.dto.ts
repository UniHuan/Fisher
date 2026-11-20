import { ApiPropertyOptional } from '@nestjs/swagger';
import { REPORT_CONTENT_TYPE } from '@szfisher/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);

export class ReportListQueryDto {
  @ApiPropertyOptional({ enum: CONTENT_TYPES, example: 'catch' })
  @IsOptional()
  @IsIn(CONTENT_TYPES)
  content_type?: string;

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
