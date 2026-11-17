import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POI_TYPE } from '@szfisher/shared';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const POI_STATUS = {
  ACTIVE: 'active',
  HIDDEN: 'hidden',
} as const;

export class CreatePoiDto {
  @ApiProperty({ minLength: 1, maxLength: 80, example: '深圳湾公园停车场' })
  @IsString()
  @Length(1, 80)
  poi_name!: string;

  @ApiProperty({ enum: Object.values(POI_TYPE), example: 'parking' })
  @IsIn(Object.values(POI_TYPE))
  poi_type!: string;

  @ApiProperty({
    example: '22.518000',
    description: 'GCJ-02 latitude string',
  })
  @IsNumberString()
  latitude!: string;

  @ApiProperty({
    example: '113.953000',
    description: 'GCJ-02 longitude string',
  })
  @IsNumberString()
  longitude!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '4.5' })
  @IsOptional()
  @IsNumberString()
  rating?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: '全天' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  open_time?: string | null;
}

export class UpdatePoiDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 80)
  poi_name?: string;

  @ApiPropertyOptional({ enum: Object.values(POI_TYPE) })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(Object.values(POI_TYPE))
  poi_type?: string;

  @ApiPropertyOptional({ example: '22.518000' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumberString()
  latitude?: string;

  @ApiPropertyOptional({ example: '113.953000' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumberString()
  longitude?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '4.5' })
  @IsOptional()
  @IsNumberString()
  rating?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  open_time?: string | null;

  @ApiPropertyOptional({ enum: Object.values(POI_STATUS), example: 'hidden' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(Object.values(POI_STATUS))
  status?: string;
}

export class BindPoiDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  @IsString()
  @Length(26, 26)
  poi_id!: string;

  @ApiPropertyOptional({
    enum: Object.values(POI_TYPE),
    nullable: true,
    description: 'Optional type override in this spot context',
  })
  @IsOptional()
  @IsIn(Object.values(POI_TYPE))
  poi_type_override?: string | null;

  @ApiPropertyOptional({ type: 'integer', minimum: -1000000, maximum: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sort_order?: number | null;
}

export class AdminPoiListQueryDto {
  @ApiPropertyOptional({ enum: Object.values(POI_TYPE) })
  @IsOptional()
  @IsIn(Object.values(POI_TYPE))
  poi_type?: string;

  @ApiPropertyOptional({ enum: Object.values(POI_STATUS) })
  @IsOptional()
  @IsIn(Object.values(POI_STATUS))
  status?: string;

  @ApiPropertyOptional({ maxLength: 40, example: '停车场' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  keyword?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'Page number, starting at 1; defaults to 1',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    description: 'Page size; defaults to 20',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
