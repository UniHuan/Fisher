import { ApiProperty } from '@nestjs/swagger';
import { FEEDBACK_CATEGORY, FEEDBACK_STATUS } from '@szfisher/shared';

const STATUSES: readonly string[] = Object.values(FEEDBACK_STATUS);
const CATEGORIES: readonly string[] = Object.values(FEEDBACK_CATEGORY);

export class AdminFeedbackItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  feedback_id!: string;

  @ApiProperty({ enum: CATEGORIES, example: 'bug' })
  category!: string;

  @ApiProperty({ example: '钓点详情页的收藏按钮点击后没有反应。' })
  content!: string;

  @ApiProperty({ enum: STATUSES, example: 'open' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: '钓友 A7K2' })
  user_nickname!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '01HX0000000000000000000001' })
  spot_id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾公园' })
  spot_name!: string | null;

  @ApiProperty({ type: 'integer', example: 2 })
  image_count!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  handled_at!: string | null;
}

export class AdminFeedbackPageDto {
  @ApiProperty({ type: () => [AdminFeedbackItemDto] })
  items!: AdminFeedbackItemDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: 'integer', example: 12 })
  total!: number;
}

export class AdminFeedbackDetailDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  feedback_id!: string;

  @ApiProperty({ enum: CATEGORIES, example: 'bug' })
  category!: string;

  @ApiProperty({ example: '钓点详情页的收藏按钮点击后没有反应。' })
  content!: string;

  @ApiProperty({ type: String, nullable: true, example: 'wx_feedback_test' })
  contact!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'pages/detail/detail' })
  page!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '01HX0000000000000000000001' })
  spot_id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾公园' })
  spot_name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1.0.0' })
  app_version!: string | null;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'string' },
    nullable: true,
    example: { model: 'iPhone 15 Pro', system: 'iOS 18.1' },
    description: 'Only model, system, wechat_version and sdk_version are returned',
  })
  device_info!: Record<string, string> | null;

  @ApiProperty({
    type: [String],
    description: 'Signed 15-minute preview URLs for the private work bucket',
    example: ['/api/v1/uploads/preview?key=feedback%2F...'],
  })
  images!: string[];

  @ApiProperty({ enum: STATUSES, example: 'open' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: '钓友 A7K2' })
  user_nickname!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  handler_id!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  handled_at!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '已复现，安排修复' })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class AdminFeedbackUpdateResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  feedback_id!: string;

  @ApiProperty({ enum: STATUSES, example: 'reviewing' })
  status!: string;
}
