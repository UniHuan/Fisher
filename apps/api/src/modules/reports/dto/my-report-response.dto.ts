import { ApiProperty } from '@nestjs/swagger';
import { MODERATION_STATUS, REPORT_CONTENT_TYPE } from '@szfisher/shared';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);
const MODERATION_STATUSES: readonly string[] = Object.values(MODERATION_STATUS);

export class MyReportSpotDto {
  @ApiProperty({ example: '01HX0000000000000000000001' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园东门钓点' })
  spot_name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'open' })
  open_status!: string | null;

  @ApiProperty({
    example: true,
    description: 'False when the spot is banned, offline or deleted',
  })
  can_open!: boolean;
}

export class MyReportItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({ enum: CONTENT_TYPES, example: 'comment' })
  content_type!: string;

  @ApiProperty({ example: '今天鱼口不错' })
  content!: string;

  @ApiProperty({
    type: [String],
    example: ['/api/v1/uploads/preview?key=...&area=working&expires=...&signature=...'],
    description:
      'Public paths for visible images; 15-minute signed work-bucket previews for pending, rejected and removed images',
  })
  images!: string[];

  @ApiProperty({ enum: MODERATION_STATUSES, example: 'machine_pending' })
  moderation_status!: string;

  @ApiProperty({ type: String, nullable: true, example: '广告引流' })
  reject_reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  audit_time!: string | null;

  @ApiProperty({ type: () => MyReportSpotDto })
  spot!: MyReportSpotDto;
}

export class MyReportPageDto {
  @ApiProperty({ type: () => [MyReportItemDto] })
  items!: MyReportItemDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: 'integer', example: 3 })
  total!: number;
}
