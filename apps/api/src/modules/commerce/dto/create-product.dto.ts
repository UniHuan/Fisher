import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COMMERCE_CHANNEL,
  PRODUCT_CATEGORY,
  PURCHASE_ACTION_TYPE,
} from '@szfisher/shared';

const CATEGORIES: string[] = Object.values(PRODUCT_CATEGORY);
const CHANNELS: string[] = Object.values(COMMERCE_CHANNEL);
const PURCHASE_ACTIONS: string[] = [
  PURCHASE_ACTION_TYPE.MINI_PROGRAM,
  PURCHASE_ACTION_TYPE.H5,
  PURCHASE_ACTION_TYPE.COPY_LINK,
];

export const MAX_PRODUCT_IMAGES = 9;
export const MAX_PRODUCT_CHANNELS = 2;
export const CHANNEL_STATUSES: string[] = ['active', 'disabled'];
/** Server-generated product images always use this shape; ownership is checked in the service. */
export const PRODUCT_IMAGE_KEY_PATTERN =
  /^products\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;
const PRODUCT_IMAGE_KEY_MESSAGE =
  'Image keys must match products/<productId>/<ULID>.webp';

export class ProductChannelInputDto {
  @ApiProperty({
    enum: CHANNELS,
    example: COMMERCE_CHANNEL.WEIDIAN,
    description: 'V1 accepts only weidian.',
  })
  @IsString()
  @IsIn(CHANNELS)
  channel!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64, example: 'wd-item-10001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  external_product_id?: string | null;

  @ApiProperty({
    enum: PURCHASE_ACTIONS,
    example: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
    description: 'Action type the client executes. V1 accepts mini_program, h5 and copy_link.',
  })
  @IsString()
  @IsIn(PURCHASE_ACTIONS)
  purchase_action!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { app_id: 'wx0123456789abcdef', path: '/pages/product/detail?id=1' },
    description: 'Action parameters. The type is supplied by purchase_action, not this object.',
  })
  @IsObject()
  action_payload!: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32, example: '¥299 起' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  price_display?: string | null;

  @ApiPropertyOptional({ enum: CHANNEL_STATUSES, example: 'active' })
  @IsOptional()
  @IsString()
  @IsIn(CHANNEL_STATUSES)
  status?: string;
}

export class CreateProductDto {
  @ApiProperty({ minLength: 1, maxLength: 80, example: 'UniHuan 轻量路亚竿' })
  @IsString()
  @Length(1, 80)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120, example: '深圳湾岸钓适用' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ enum: CATEGORIES, example: PRODUCT_CATEGORY.ROD })
  @IsString()
  @IsIn(CATEGORIES)
  category!: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: 1000000,
    default: 0,
    description: 'Larger values sort first on the brand page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sort_weight?: number;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_PRODUCT_IMAGES,
    example: ['products/01HX0000000000000000000000/01HX0000000000000000000001.webp'],
    description:
      'Keys uploaded for this product. Create listens on a generated id, so images are attached after the draft exists.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @IsString({ each: true })
  @Matches(PRODUCT_IMAGE_KEY_PATTERN, { each: true, message: PRODUCT_IMAGE_KEY_MESSAGE })
  image_keys?: string[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Must belong to this product and be one of image_keys when set.',
  })
  @IsOptional()
  @IsString()
  @Matches(PRODUCT_IMAGE_KEY_PATTERN, { message: PRODUCT_IMAGE_KEY_MESSAGE })
  cover_image_key?: string | null;

  @ApiProperty({
    type: () => [ProductChannelInputDto],
    minItems: 1,
    maxItems: MAX_PRODUCT_CHANNELS,
    description: 'V1 accepts exactly one weidian channel.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCT_CHANNELS)
  @ValidateNested({ each: true })
  @Type(() => ProductChannelInputDto)
  channels!: ProductChannelInputDto[];
}
