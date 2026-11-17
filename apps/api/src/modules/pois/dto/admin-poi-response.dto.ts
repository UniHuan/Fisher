import { ApiProperty } from '@nestjs/swagger';
import { POI_TYPE } from '@szfisher/shared';
import { POI_STATUS } from './admin-poi.dto';

export class AdminPoiItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  poi_id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'tencent-123' })
  external_poi_id!: string | null;

  @ApiProperty({ example: '深圳湾公园停车场' })
  poi_name!: string;

  @ApiProperty({ enum: Object.values(POI_TYPE), example: 'parking' })
  poi_type!: string;

  @ApiProperty({ example: '22.518000' })
  latitude!: string;

  @ApiProperty({ example: '113.953000' })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true, example: '深圳市南山区…' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4.5' })
  rating!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '全天' })
  open_time!: string | null;

  @ApiProperty({ example: 'manual' })
  source!: string;

  @ApiProperty({ enum: Object.values(POI_STATUS), example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class AdminPoiPageDto {
  @ApiProperty({ type: () => [AdminPoiItemDto] })
  items!: AdminPoiItemDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  page_size!: number;

  @ApiProperty({ type: 'integer', example: 100 })
  total!: number;

  @ApiProperty({ example: true })
  has_more!: boolean;
}

export class AdminSpotPoiItemDto extends AdminPoiItemDto {
  @ApiProperty({ enum: Object.values(POI_TYPE), example: 'parking' })
  effective_type!: string;

  @ApiProperty({ type: String, nullable: true, enum: Object.values(POI_TYPE) })
  poi_type_override!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  sort_order!: number | null;

  @ApiProperty({ type: 'integer', example: 126 })
  distance_m!: number;
}

export class PoiSyncRunDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  sync_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ enum: ['running', 'success', 'failed'], example: 'success' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  poi_count!: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  error_message!: string | null;

  @ApiProperty({ type: 'integer', example: 6 })
  quota_used!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  started_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finished_at!: string | null;
}

export class AdminSpotPoiListDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ type: () => [AdminSpotPoiItemDto] })
  items!: AdminSpotPoiItemDto[];

  @ApiProperty({ type: () => PoiSyncRunDto, nullable: true })
  last_sync!: PoiSyncRunDto | null;
}

export class AdminSpotPoiUnbindDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  spot_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000000' })
  poi_id!: string;

  @ApiProperty({ example: true })
  unbound!: true;
}
