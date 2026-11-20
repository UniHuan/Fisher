import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MODERATION_STATUS, REPORT_CONTENT_TYPE } from '@szfisher/shared';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CONTENT_TYPES: readonly string[] = Object.values(REPORT_CONTENT_TYPE);

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
