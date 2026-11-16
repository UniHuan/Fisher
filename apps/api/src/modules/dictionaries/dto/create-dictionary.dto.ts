import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { DICTIONARY_TYPES } from '../dictionary.constants';

export class CreateDictionaryDto {
  @ApiProperty({ enum: DICTIONARY_TYPES, example: 'poi_type' })
  @IsIn(DICTIONARY_TYPES)
  dict_type!: string;

  @ApiProperty({ maxLength: 64, example: 'food' })
  @IsString()
  @Length(1, 64)
  dict_key!: string;

  @ApiProperty({ maxLength: 128, example: '餐饮' })
  @IsString()
  @Length(1, 128)
  dict_label!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sort_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  parent_key?: string | null;
}
