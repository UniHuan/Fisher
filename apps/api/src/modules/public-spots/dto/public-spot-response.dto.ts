import { ApiProperty } from '@nestjs/swagger';
import { OPEN_STATUS } from '@szfisher/shared';
import type { Freshness } from '../public-spot.types';

const FRESHNESS = ['fresh', 'stale', 'expired'] as const;
const CONDITION_FRESHNESS = ['today', 'recent', 'stale'] as const;

export class PublicConditionDto {
  @ApiProperty({ type: String, nullable: true, example: 'open' })
  open_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'free' })
  fee_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'low' })
  crowd_level!: string | null;

  @ApiProperty({ type: [String], example: ['toilet', 'parking'] })
  facilities!: string[];

  @ApiProperty({ type: String, format: 'date-time' })
  observed_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  reported_at!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  age_hours!: number;

  @ApiProperty({ enum: CONDITION_FRESHNESS, example: 'today' })
  freshness!: (typeof CONDITION_FRESHNESS)[number];

  @ApiProperty({ type: 'integer', required: false, example: 3 })
  report_count_7d?: number;
}

export class PublicSpotListItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园东门钓点' })
  spot_name!: string;

  @ApiProperty({ type: String, nullable: true, example: '南山区' })
  district!: string | null;

  @ApiProperty({ type: [String], example: ['luofei', 'jiyu'] })
  fish_types!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'free' })
  fee_status!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sea' })
  water_type!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'park' })
  venue_type!: string | null;

  @ApiProperty({ enum: Object.values(OPEN_STATUS), example: 'open' })
  open_status!: string;

  @ApiProperty({ example: false })
  is_core!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'https://fish-static.unihuan.com/spots/...' })
  cover_image_url!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verified_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;

  @ApiProperty({ enum: FRESHNESS, example: 'fresh' })
  freshness!: Freshness;

  @ApiProperty({ type: () => PublicConditionDto, nullable: true })
  latest_condition!: PublicConditionDto | null;

  @ApiProperty({ type: 'integer', required: false, example: 1830 })
  distance_m?: number;
}

export class PublicSpotPageDto {
  @ApiProperty({ type: () => [PublicSpotListItemDto] })
  items!: PublicSpotListItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  page_size!: number;

  @ApiProperty({ type: 'integer', example: 100 })
  total!: number;

  @ApiProperty({ example: true })
  has_more!: boolean;
}

export class PublicNavigationDto {
  @ApiProperty({ example: '深圳湾公园东门钓点' })
  name!: string;

  @ApiProperty({ example: '22.517600' })
  latitude!: string;

  @ApiProperty({ example: '113.952300' })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true, example: '深圳市南山区深圳湾公园东门' })
  address!: string | null;
}

export class PublicPoiItemDto {
  @ApiProperty({ example: '01HX0000000000000000000002' })
  poi_id!: string;

  @ApiProperty({ example: '深圳湾公园停车场' })
  poi_name!: string;

  @ApiProperty({ example: 'parking' })
  poi_type!: string;

  @ApiProperty({ example: '22.517900' })
  latitude!: string;

  @ApiProperty({ example: '113.953000' })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4.6' })
  rating!: string | null;

  @ApiProperty({ type: String, nullable: true })
  open_time!: string | null;

  @ApiProperty({ type: 'integer', example: 120 })
  distance_m!: number;

  @ApiProperty({ example: 'tencent' })
  source!: string;

  @ApiProperty({ example: '腾讯位置服务' })
  source_label!: string;

  @ApiProperty({ type: () => PublicNavigationDto })
  navigation!: PublicNavigationDto;
}

export class PublicPoiGroupDto {
  @ApiProperty({ example: 'parking' })
  poi_type!: string;

  @ApiProperty({ type: 'integer', example: 4 })
  count!: number;

  @ApiProperty({ type: () => [PublicPoiItemDto] })
  items!: PublicPoiItemDto[];
}

export class PublicSpotDetailDto extends PublicSpotListItemDto {
  @ApiProperty({ example: '440300' })
  city_code!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ example: '22.517600' })
  latitude!: string;

  @ApiProperty({ example: '113.952300' })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true })
  fee_unit!: string | null;

  @ApiProperty({ type: String, nullable: true })
  fee_detail!: string | null;

  @ApiProperty({ type: [String], example: ['tai_diao', 'lu_ya'] })
  fishing_method!: string[];

  @ApiProperty({ type: String, nullable: true })
  ban_note!: string | null;

  @ApiProperty({ type: String, nullable: true })
  open_hours!: string | null;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  tips!: string | null;

  @ApiProperty({ type: [String], example: ['https://fish-static.unihuan.com/spots/...'] })
  images!: string[];

  @ApiProperty({ type: 'integer', example: 3 })
  image_count!: number;

  @ApiProperty({ type: () => PublicNavigationDto, nullable: true })
  navigation!: PublicNavigationDto | null;

  @ApiProperty({ example: false })
  is_banned!: boolean;

  @ApiProperty({ type: 'integer', nullable: true, example: 12 })
  verified_days_ago!: number | null;

  @ApiProperty({ type: () => [PublicPoiGroupDto] })
  poi_summary!: PublicPoiGroupDto[];
}

export class PublicPoiListDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ type: () => [PublicPoiItemDto] })
  items!: PublicPoiItemDto[];

  @ApiProperty({ example: '腾讯位置服务' })
  data_source!: string;

  @ApiProperty({ type: String, nullable: true, example: 'parking' })
  poi_type!: string | null;
}

export class PublicMapItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ example: '深圳湾公园东门钓点' })
  spot_name!: string;

  @ApiProperty({ type: String, nullable: true })
  district!: string | null;

  @ApiProperty({ example: '22.517600' })
  latitude!: string;

  @ApiProperty({ example: '113.952300' })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true })
  fee_status!: string | null;

  @ApiProperty({ enum: Object.values(OPEN_STATUS), example: 'open' })
  open_status!: string;

  @ApiProperty({ example: false })
  is_core!: boolean;

  @ApiProperty({ type: String, nullable: true })
  cover_image_url!: string | null;
}

export class PublicMapBoundsDto {
  @ApiProperty({ example: '22.600000' })
  north!: string;

  @ApiProperty({ example: '22.400000' })
  south!: string;

  @ApiProperty({ example: '114.100000' })
  east!: string;

  @ApiProperty({ example: '113.900000' })
  west!: string;
}

export class PublicMapClusterDto {
  @ApiProperty({ example: '22.500000' })
  latitude!: string;

  @ApiProperty({ example: '114.000000' })
  longitude!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  count!: number;

  @ApiProperty({ type: () => PublicMapBoundsDto })
  bounds!: PublicMapBoundsDto;
}

export class PublicMapResponseDto {
  @ApiProperty({ enum: ['points', 'clusters'], example: 'points' })
  mode!: 'points' | 'clusters';

  @ApiProperty({ type: 'integer', example: 100 })
  total!: number;

  @ApiProperty({ type: 'integer', example: 12 })
  zoom!: number;

  @ApiProperty({ type: () => [PublicMapItemDto] })
  items!: PublicMapItemDto[];

  @ApiProperty({ type: () => [PublicMapClusterDto] })
  clusters!: PublicMapClusterDto[];
}
