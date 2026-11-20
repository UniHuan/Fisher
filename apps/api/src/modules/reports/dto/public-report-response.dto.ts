import { ApiProperty } from '@nestjs/swagger';
import { REPORT_CONTENT_TYPE } from '@szfisher/shared';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);

export class PublicReportAuthorDto {
  @ApiProperty({ type: String, nullable: true, example: '钓友 A7K2' })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  avatar_url!: string | null;
}

export class PublicReportItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  spot_id!: string;

  @ApiProperty({ enum: CONTENT_TYPES, example: 'comment' })
  content_type!: string;

  @ApiProperty({ example: '今天鱼口不错' })
  content!: string;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Relative public image paths; empty until image uploads land',
  })
  images!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'luofei' })
  fish_key!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.50',
    description: 'Decimal serialized as a string',
  })
  catch_weight_kg!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: 'integer', example: 18 })
  like_count!: number;

  @ApiProperty({ example: false })
  liked_by_me!: boolean;

  @ApiProperty({ example: false })
  is_mine!: boolean;

  @ApiProperty({ example: false })
  is_adopted!: boolean;

  @ApiProperty({ type: () => PublicReportAuthorDto })
  author!: PublicReportAuthorDto;
}

export class PublicReportPageDto {
  @ApiProperty({ type: () => [PublicReportItemDto] })
  items!: PublicReportItemDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  next_cursor!: string | null;

  @ApiProperty({ type: 'integer', example: 12 })
  total!: number;
}
