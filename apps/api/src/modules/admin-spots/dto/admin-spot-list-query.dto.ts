import { ApiPropertyOptional } from '@nestjs/swagger';
import { SPOT_STATUS } from '@szfisher/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AdminSpotListQueryDto {
  @ApiPropertyOptional({ enum: Object.values(SPOT_STATUS), example: 'draft' })
  @IsOptional()
  @IsIn(Object.values(SPOT_STATUS))
  status?: string;

  @ApiPropertyOptional({ maxLength: 32, example: '南山区' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  district?: string;

  @ApiPropertyOptional({
    description: 'Normalized spot name keyword, clamped by the service',
    maxLength: 40,
    example: '深圳湾',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  keyword?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on updated_at (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  updated_from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on updated_at (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  updated_to?: string;

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
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
