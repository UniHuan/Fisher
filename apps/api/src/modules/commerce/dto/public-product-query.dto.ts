import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  PRODUCT_CATEGORY,
  PRODUCT_QUERY_SURFACE,
  splitCsv,
  type ProductQuerySurface,
} from '@szfisher/shared';

const SURFACES: string[] = Object.values(PRODUCT_QUERY_SURFACE);
const CATEGORIES: string[] = Object.values(PRODUCT_CATEGORY);

export class PublicProductQueryDto {
  @ApiProperty({
    enum: SURFACES,
    example: PRODUCT_QUERY_SURFACE.SPOT_DETAIL,
    description: 'Requested public surface. home and report_detail return an empty list in V1.',
  })
  @IsString()
  @IsIn(SURFACES)
  surface!: ProductQuerySurface;

  @ApiPropertyOptional({
    description: 'Spot ULID. Required when surface=spot_detail and ignored for brand_page.',
    example: '01HX0000000000000000000000',
  })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  target_id?: string;

  @ApiPropertyOptional({
    description: 'Reserved district filter. Accepted for compatibility and ignored in V1.',
    example: '南山区',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  district?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Comma-separated fish dictionary keys, at most 5.',
    example: 'luofei,jiyu',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? splitCsv(value) : value))
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  fish_keys?: string[];

  @ApiPropertyOptional({ enum: CATEGORIES, example: PRODUCT_CATEGORY.ROD })
  @IsOptional()
  @IsString()
  @IsIn(CATEGORIES)
  category?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 12,
    default: 6,
    description: 'Only used by spot_detail.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  limit?: number;
}
