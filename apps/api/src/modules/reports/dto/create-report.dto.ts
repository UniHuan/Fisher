import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CONDITION_CROWD_LEVEL,
  CONDITION_FACILITY,
  MODERATION_STATUS,
  OPEN_STATUS,
  REPORT_CONTENT_TYPE,
} from '@szfisher/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);

/** Work-bucket keys produced by `POST /uploads/ugc`; ownership is checked later. */
export const REPORT_IMAGE_KEY_PATTERN =
  /^ugc\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;

export class CreateReportConditionDto {
  @ApiPropertyOptional({ enum: Object.values(OPEN_STATUS) })
  @IsOptional()
  @IsIn(Object.values(OPEN_STATUS))
  open_status?: string;

  @ApiPropertyOptional({ enum: ['free', 'paid', 'member'] })
  @IsOptional()
  @IsIn(['free', 'paid', 'member'])
  fee_status?: string;

  @ApiPropertyOptional({ enum: Object.values(CONDITION_CROWD_LEVEL) })
  @IsOptional()
  @IsIn(Object.values(CONDITION_CROWD_LEVEL))
  crowd_level?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(Object.values(CONDITION_FACILITY), { each: true })
  facilities?: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  observed_at?: string;
}

export class CreateReportDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  @IsString()
  @Length(26, 26)
  spot_id!: string;

  @ApiProperty({ enum: CONTENT_TYPES, example: 'comment' })
  @IsIn(CONTENT_TYPES)
  content_type!: string;

  @ApiProperty({
    description:
      'Plain text, 1 to 500 Unicode code points after trimming. Emoji count as one.',
    example: '今天罗非爆护，巴掌大，钓了十几条。',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 6,
    description:
      'Work-bucket keys returned by POST /uploads/ugc; at most 6 after deduplication, each owned by the current user',
    example: ['ugc/01HX0000000000000000000000/01HX0000000000000000000001.webp'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Matches(REPORT_IMAGE_KEY_PATTERN, { each: true })
  image_keys?: string[];

  @ApiPropertyOptional({ description: 'Required for catch content', maxLength: 64, example: 'luofei' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  fish_key?: string;

  @ApiPropertyOptional({
    description: 'Catch weight in kilograms; catch content only',
    minimum: 0.01,
    maximum: 999.99,
    example: 2.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999.99)
  catch_weight_kg?: number;

  @ApiPropertyOptional({ type: () => CreateReportConditionDto })
  @IsOptional()
  @Type(() => CreateReportConditionDto)
  @ValidateNested()
  condition?: CreateReportConditionDto;

  @ApiPropertyOptional({
    description: 'Required the first time the user accepts the community terms',
    maxLength: 16,
    example: '2026-11-20',
  })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  terms_version?: string;
}

export class CreateReportResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({
    enum: Object.values(MODERATION_STATUS),
    example: 'published',
    description: '201 is returned regardless of the machine review outcome',
  })
  moderation_status!: string;

  @ApiProperty({ example: '已发布' })
  message!: string;
}
