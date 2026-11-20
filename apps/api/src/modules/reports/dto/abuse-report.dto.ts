import { ApiProperty } from '@nestjs/swagger';
import { ABUSE_REASON } from '@szfisher/shared';
import { IsIn } from 'class-validator';

const ABUSE_REASONS: readonly string[] = Object.values(ABUSE_REASON);

export class AbuseReportDto {
  @ApiProperty({
    enum: ABUSE_REASONS,
    example: ABUSE_REASON.AD,
    description: 'Abuse category; free text is deliberately not collected',
  })
  @IsIn(ABUSE_REASONS)
  reason!: string;
}

export class AbuseReportResponseDto {
  @ApiProperty({
    example: true,
    description: 'Always true; a duplicate report from the same user is success',
  })
  reported!: boolean;
}

export class ReportLikeResponseDto {
  @ApiProperty({ example: true })
  liked!: boolean;

  @ApiProperty({ type: 'integer', example: 18 })
  like_count!: number;
}

export class DeleteReportResponseDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
