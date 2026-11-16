import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  admin_id?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  action?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  entity_type?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
