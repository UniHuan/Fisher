import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PLACEMENT_SCOPE, PLACEMENT_SURFACE } from '@szfisher/shared';

export const MAX_PLACEMENT_FISH_KEYS = 5;
export const MAX_PLACEMENT_FISH_KEY_LENGTH = 64;
export const PLACEMENT_SURFACES: string[] = [PLACEMENT_SURFACE.SPOT_DETAIL];
export const PLACEMENT_SCOPES: string[] = Object.values(PLACEMENT_SCOPE);
export const PLACEMENT_STATUSES: string[] = ['active', 'disabled'];

export class CreatePlacementDto {
  @ApiProperty({ minLength: 26, maxLength: 26, example: '01HX0000000000000000000000' })
  @IsString()
  @Length(26, 26)
  product_id!: string;

  @ApiProperty({
    enum: PLACEMENT_SURFACES,
    example: PLACEMENT_SURFACE.SPOT_DETAIL,
    description: 'V1 opens spot_detail only; home and report_detail stay reserved.',
  })
  @IsString()
  @IsIn(PLACEMENT_SURFACES)
  surface!: string;

  @ApiProperty({
    enum: PLACEMENT_SCOPES,
    example: PLACEMENT_SCOPE.SPOT,
    description: 'spot targets one spot id; fish matches requested fish keys.',
  })
  @IsString()
  @IsIn(PLACEMENT_SCOPES)
  scope!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 26,
    maxLength: 26,
    description: 'Required when scope=spot and must be omitted when scope=fish.',
    example: '01HX0000000000000000000000',
  })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  target_id?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_PLACEMENT_FISH_KEYS,
    description: 'Required when scope=fish and must be empty when scope=spot.',
    example: ['luofei'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLACEMENT_FISH_KEYS)
  @IsString({ each: true })
  @MaxLength(MAX_PLACEMENT_FISH_KEY_LENGTH, { each: true })
  fish_keys?: string[];

  @ApiPropertyOptional({
    type: 'integer',
    default: 0,
    description: 'Smaller values sort first within a scope.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-21T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  starts_at?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  ends_at?: string | null;

  @ApiPropertyOptional({ enum: PLACEMENT_STATUSES, default: 'active' })
  @IsOptional()
  @IsString()
  @IsIn(PLACEMENT_STATUSES)
  status?: string;
}
