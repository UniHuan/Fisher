import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  COMMERCE_CHANNEL,
  PRODUCT_CATEGORY,
  PRODUCT_STATUS,
} from '@szfisher/shared';
import { V1_PURCHASE_ACTION_TYPES } from './purchase-action.dto';

const STATUSES: string[] = Object.values(PRODUCT_STATUS);
const CATEGORIES: string[] = Object.values(PRODUCT_CATEGORY);
const CHANNELS: string[] = Object.values(COMMERCE_CHANNEL);
const PURCHASE_ACTIONS: string[] = V1_PURCHASE_ACTION_TYPES;

export class AdminProductListQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, example: PRODUCT_STATUS.DRAFT })
  @IsOptional()
  @IsString()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: CATEGORIES, example: PRODUCT_CATEGORY.ROD })
  @IsOptional()
  @IsString()
  @IsIn(CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Title keyword', example: '路亚竿' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Page number, starting at 1; defaults to 1',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Page size; defaults to 20',
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  page_size?: number;
}

export class AdminProductChannelDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  channel_id!: string;

  @ApiProperty({ enum: CHANNELS, example: COMMERCE_CHANNEL.WEIDIAN })
  channel!: string;

  @ApiProperty({ type: String, nullable: true, example: 'wd-item-10001' })
  external_product_id!: string | null;

  @ApiProperty({ enum: PURCHASE_ACTIONS, example: 'mini_program' })
  purchase_action!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { type: 'mini_program', app_id: 'wx0123456789abcdef', path: '/pages/product/detail?id=1' },
  })
  action_payload!: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true, example: '¥299 起' })
  price_display!: string | null;

  @ApiProperty({ example: 'active' })
  status!: string;
}

export class AdminProductListItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  product_id!: string;

  @ApiProperty({ example: 'UniHuan 轻量路亚竿' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾岸钓适用' })
  subtitle!: string | null;

  @ApiProperty({ enum: CATEGORIES, example: PRODUCT_CATEGORY.ROD })
  category!: string;

  @ApiProperty({ enum: STATUSES, example: PRODUCT_STATUS.DRAFT })
  status!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort_weight!: number;

  @ApiProperty({ type: String, nullable: true })
  cover_image_url!: string | null;

  @ApiProperty({ type: 'integer', example: 1 })
  channel_count!: number;

  @ApiProperty({ type: 'integer', example: 2 })
  placement_count!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class AdminProductPageDto {
  @ApiProperty({ type: () => [AdminProductListItemDto] })
  items!: AdminProductListItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  page_size!: number;

  @ApiProperty({ type: 'integer', example: 42 })
  total!: number;

  @ApiProperty({ example: true })
  has_more!: boolean;
}

export class AdminProductDetailDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  product_id!: string;

  @ApiProperty({ example: 'UniHuan 轻量路亚竿' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾岸钓适用' })
  subtitle!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Admin copy; never written to audit logs' })
  description!: string | null;

  @ApiProperty({ enum: CATEGORIES, example: PRODUCT_CATEGORY.ROD })
  category!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort_weight!: number;

  @ApiProperty({ enum: STATUSES, example: PRODUCT_STATUS.DRAFT })
  status!: string;

  @ApiProperty({ type: [String] })
  image_keys!: string[];

  @ApiProperty({
    type: [String],
    description: 'Signed working previews while draft; public URLs once active or archived',
  })
  image_urls!: string[];

  @ApiProperty({ type: String, nullable: true })
  cover_image_key!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cover_image_url!: string | null;

  @ApiProperty({ type: () => [AdminProductChannelDto] })
  channels!: AdminProductChannelDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}
