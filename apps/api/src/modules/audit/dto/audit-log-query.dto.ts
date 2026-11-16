import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AuditLogQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by admin ULID; operators are scoped to themselves regardless',
    minLength: 26,
    maxLength: 26,
    example: '01HX0000000000000000000000',
  })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  admin_id?: string;

  @ApiPropertyOptional({
    description: 'Exact audit action name',
    minLength: 1,
    maxLength: 64,
    example: 'dictionary.update',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  action?: string;

  @ApiPropertyOptional({
    description: 'Exact entity type',
    minLength: 1,
    maxLength: 64,
    example: 'dictionary',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  entity_type?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on created_at (ISO 8601)',
    type: String,
    format: 'date-time',
    example: '2026-11-16T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on created_at (ISO 8601)',
    type: String,
    format: 'date-time',
    example: '2026-11-16T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Page number, starting at 1', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({
    description: 'Page size',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
