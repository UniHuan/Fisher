import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class PublicSpotListQueryDto {
  @ApiPropertyOptional({ maxLength: 32, example: '南山区' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  district?: string;

  @ApiPropertyOptional({ description: 'Comma-separated fish type keys', example: 'luofei,jiyu' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fish_types?: string;

  @ApiPropertyOptional({ example: 'free' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  fee_status?: string;

  @ApiPropertyOptional({ description: 'Comma-separated water type keys', example: 'sea,river' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  water_type?: string;

  @ApiPropertyOptional({ description: 'Comma-separated venue type keys', example: 'wild,park' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  venue_type?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated open statuses; defaults to open,paused',
    example: 'open,paused',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  open_status?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_banned?: boolean;

  @ApiPropertyOptional({ maxLength: 40, example: '深圳湾' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  keyword?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, example: 22.5431 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, example: 114.0579 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ enum: ['distance', 'recommended', 'updated_at'] })
  @IsOptional()
  @IsIn(['distance', 'recommended', 'updated_at'])
  sort?: 'distance' | 'recommended' | 'updated_at';

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  page_size?: number;
}
