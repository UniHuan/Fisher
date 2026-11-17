import { ApiProperty } from '@nestjs/swagger';
import { SPOT_STATUS } from '@szfisher/shared';

export class AdminSpotListItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园钓点' })
  spot_name!: string;

  @ApiProperty({ type: String, nullable: true, example: '南山区' })
  district!: string | null;

  @ApiProperty({ enum: Object.values(SPOT_STATUS), example: 'draft' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: 'open' })
  open_status!: string | null;

  @ApiProperty({ example: false })
  is_core!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '深圳市南山区…' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'spots/a.jpg' })
  cover_image_key!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://fish-static.unihuan.com/spots/...',
  })
  cover_image_url!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verified_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class AdminSpotPageDto {
  @ApiProperty({ type: () => [AdminSpotListItemDto] })
  items!: AdminSpotListItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  page_size!: number;

  @ApiProperty({ type: 'integer', example: 100 })
  total!: number;

  @ApiProperty({ example: true })
  has_more!: boolean;
}

export class AdminSpotDetailDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园钓点' })
  spot_name!: string;

  @ApiProperty({ example: '440300' })
  city_code!: string;

  @ApiProperty({ type: String, nullable: true, example: '南山区' })
  district!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '22.517600' })
  latitude!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '113.952300' })
  longitude!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '22.517600' })
  nav_latitude!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '113.952300' })
  nav_longitude!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parking_latitude!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parking_longitude!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '深圳市南山区…' })
  address!: string | null;

  @ApiProperty({ type: [String], example: ['luofei'] })
  fish_types!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'free' })
  fee_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'day' })
  fee_unit!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '80 元一天' })
  fee_detail!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sea' })
  water_type!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'wild' })
  venue_type!: string | null;

  @ApiProperty({ type: [String], example: ['tai_diao'] })
  fishing_method!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'open' })
  open_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  ban_note!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '06:00 至 22:00' })
  open_hours!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  spot_score!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾公园内' })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  tips!: string | null;

  @ApiProperty({ type: [String], example: ['spots/a.jpg'] })
  images!: string[];

  @ApiProperty({ type: [String], example: ['https://fish-static.unihuan.com/spots/...'] })
  image_urls!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'spots/a.jpg' })
  cover_image_key!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://fish-static.unihuan.com/spots/...',
  })
  cover_image_url!: string | null;

  @ApiProperty({ type: 'integer', example: 0 })
  sort_weight!: number;

  @ApiProperty({ example: false })
  is_core!: boolean;

  @ApiProperty({ enum: Object.values(SPOT_STATUS), example: 'draft' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: 'operation' })
  source!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verified_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class DuplicateWarningDto {
  @ApiProperty({ example: '01HX0000000000000000000001' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园钓鱼点' })
  spot_name!: string;

  @ApiProperty({ type: 'integer', example: 14 })
  distance_m!: number;
}

export class AdminSpotWriteResponseDto {
  @ApiProperty({ type: () => AdminSpotDetailDto })
  spot!: AdminSpotDetailDto;

  @ApiProperty({ type: () => [DuplicateWarningDto] })
  warnings!: DuplicateWarningDto[];
}

export class AdminSpotDeleteResponseDto {
  @ApiProperty({ example: true })
  deleted!: true;
}
