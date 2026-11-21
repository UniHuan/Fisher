import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PLACEMENT_SCOPE } from '@szfisher/shared';
import {
  PLACEMENT_SCOPES,
  PLACEMENT_STATUSES,
  PLACEMENT_SURFACES,
} from './create-placement.dto';

export class AdminPlacementListQueryDto {
  @ApiPropertyOptional({
    minLength: 26,
    maxLength: 26,
    example: '01HX0000000000000000000000',
  })
  @IsOptional()
  @IsString()
  @Length(26, 26)
  product_id?: string;

  @ApiPropertyOptional({ enum: PLACEMENT_SURFACES, example: 'spot_detail' })
  @IsOptional()
  @IsString()
  @IsIn(PLACEMENT_SURFACES)
  surface?: string;

  @ApiPropertyOptional({ enum: PLACEMENT_STATUSES, example: 'active' })
  @IsOptional()
  @IsString()
  @IsIn(PLACEMENT_STATUSES)
  status?: string;

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

export class AdminPlacementItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  placement_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000000' })
  product_id!: string;

  @ApiProperty({ enum: PLACEMENT_SURFACES, example: 'spot_detail' })
  surface!: string;

  @ApiProperty({ enum: PLACEMENT_SCOPES, example: PLACEMENT_SCOPE.SPOT })
  scope!: string;

  @ApiProperty({ type: String, nullable: true, example: '01HX0000000000000000000000' })
  target_id!: string | null;

  @ApiProperty({ type: [String], example: ['luofei'] })
  fish_keys!: string[];

  @ApiProperty({ type: 'integer', example: 0 })
  sort_order!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  starts_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ends_at!: string | null;

  @ApiProperty({ enum: PLACEMENT_STATUSES, example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class AdminPlacementListDto {
  @ApiProperty({ type: () => [AdminPlacementItemDto] })
  items!: AdminPlacementItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  page_size!: number;

  @ApiProperty({ type: 'integer', example: 42 })
  total!: number;

  @ApiProperty({ example: true })
  has_more!: boolean;
}

export class AdminPlacementDeleteDto {
  @ApiProperty({ example: true })
  deleted!: true;
}
