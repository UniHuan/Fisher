import { ApiPropertyOptional } from '@nestjs/swagger';
import { FEEDBACK_STATUS } from '@szfisher/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const STATUSES: readonly string[] = Object.values(FEEDBACK_STATUS);

export class UpdateFeedbackDto {
  @ApiPropertyOptional({ enum: STATUSES, example: FEEDBACK_STATUS.REVIEWING })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Internal handling note; never shown to the reporting user',
    maxLength: 500,
    example: '已复现，安排修复',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
