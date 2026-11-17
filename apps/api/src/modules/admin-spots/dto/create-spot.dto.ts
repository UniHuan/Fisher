import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OPEN_STATUS } from '@szfisher/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_SPOT_IMAGES, SPOT_SOURCES } from '../admin-spot.constants';

export class CreateSpotDto {
  @ApiProperty({ minLength: 1, maxLength: 60, example: '深圳湾公园钓点' })
  @IsString()
  @Length(1, 60)
  spot_name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32, example: '南山区' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  district?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '22.517600',
    description: 'GCJ-02 latitude string',
  })
  @IsOptional()
  @IsNumberString()
  latitude?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '113.952300',
    description: 'GCJ-02 longitude string',
  })
  @IsOptional()
  @IsNumberString()
  longitude?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '22.517600' })
  @IsOptional()
  @IsNumberString()
  nav_latitude?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '113.952300' })
  @IsOptional()
  @IsNumberString()
  nav_longitude?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '22.517600' })
  @IsOptional()
  @IsNumberString()
  parking_latitude?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '113.952300' })
  @IsOptional()
  @IsNumberString()
  parking_longitude?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120, example: '深圳市南山区…' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  address?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['luofei', 'jiyu'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  fish_types?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, example: 'free' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  fee_status?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'day' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  fee_unit?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, example: '80 元一天' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fee_detail?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'sea' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  water_type?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'wild' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  venue_type?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['tai_diao', 'lu_ya'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  fishing_method?: string[];

  @ApiPropertyOptional({ enum: Object.values(OPEN_STATUS), example: 'open' })
  @IsOptional()
  @IsIn(Object.values(OPEN_STATUS))
  open_status?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, example: '禁止垂钓' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  ban_note?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: '06:00 至 22:00' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  open_hours?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tips?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SPOT_IMAGES, example: ['spots/a.jpg'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SPOT_IMAGES)
  @IsString({ each: true })
  @Length(1, 255, { each: true })
  images?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  cover_image_key?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description: 'Defaults to 0',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sort_weight?: number;

  @ApiPropertyOptional({ type: Boolean, description: 'Defaults to false' })
  @IsOptional()
  @IsBoolean()
  is_core?: boolean;

  @ApiPropertyOptional({
    enum: SPOT_SOURCES,
    nullable: true,
    description: 'Defaults to operation',
  })
  @IsOptional()
  @IsIn(SPOT_SOURCES)
  source?: string | null;
}
