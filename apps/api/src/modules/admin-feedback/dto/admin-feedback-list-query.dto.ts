import { ApiPropertyOptional } from '@nestjs/swagger';
import { FEEDBACK_CATEGORY, FEEDBACK_STATUS } from '@szfisher/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STATUSES: readonly string[] = Object.values(FEEDBACK_STATUS);
const CATEGORIES: readonly string[] = Object.values(FEEDBACK_CATEGORY);

export class AdminFeedbackListQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, example: FEEDBACK_STATUS.OPEN })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: CATEGORIES, example: FEEDBACK_CATEGORY.BUG })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @ApiPropertyOptional({
    description: 'Opaque cursor: base64(created_at|feedback_id)',
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
