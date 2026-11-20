import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FEEDBACK_CATEGORY } from '@szfisher/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const CATEGORIES: readonly string[] = Object.values(FEEDBACK_CATEGORY);

/** Work-bucket keys produced by `POST /feedback/images`; ownership is checked later. */
export const FEEDBACK_IMAGE_KEY_PATTERN =
  /^feedback\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;

/**
 * Only the four context fields the spec allows. Unknown keys are rejected by the
 * global whitelist, so an openid or token can never be smuggled into the JSON.
 */
export class FeedbackDeviceInfoDto {
  @ApiPropertyOptional({ maxLength: 64, example: 'iPhone 15 Pro' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;

  @ApiPropertyOptional({ maxLength: 64, example: 'iOS 18.1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  system?: string;

  @ApiPropertyOptional({ maxLength: 32, example: '8.0.54' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  wechat_version?: string;

  @ApiPropertyOptional({ maxLength: 32, example: '3.7.1' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sdk_version?: string;
}

export class CreateFeedbackDto {
  @ApiProperty({ enum: CATEGORIES, example: 'bug' })
  @IsIn(CATEGORIES)
  category!: string;

  @ApiProperty({
    description: 'Plain text, 10 to 500 Unicode code points after trimming',
    example: '钓点详情页的收藏按钮点击后没有反应。',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({ description: 'Optional contact for follow-up', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  contact?: string;

  @ApiPropertyOptional({ description: 'Current page path', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  page?: string;

  @ApiPropertyOptional({ description: 'Spot ULID the feedback refers to' })
  @IsOptional()
  @IsString()
  @MaxLength(26)
  spot_id?: string;

  @ApiPropertyOptional({ description: 'Client version', maxLength: 32, example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  app_version?: string;

  @ApiPropertyOptional({ type: () => FeedbackDeviceInfoDto })
  @IsOptional()
  @Type(() => FeedbackDeviceInfoDto)
  @ValidateNested()
  device_info?: FeedbackDeviceInfoDto;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 3,
    description:
      'Work-bucket keys returned by POST /feedback/images; at most 3 after deduplication, each owned by the current user',
    example: ['feedback/01HX0000000000000000000000/01HX0000000000000000000001.webp'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Matches(FEEDBACK_IMAGE_KEY_PATTERN, { each: true })
  image_keys?: string[];
}
