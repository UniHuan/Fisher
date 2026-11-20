import { ApiProperty } from '@nestjs/swagger';

export class MapConfigDto {
  @ApiProperty({ example: 22.5431 })
  default_latitude!: number;

  @ApiProperty({ example: 114.0579 })
  default_longitude!: number;

  @ApiProperty({ example: 12 })
  default_zoom!: number;
}

export class FeatureFlagsDto {
  @ApiProperty({ example: true })
  map_tab!: boolean;

  @ApiProperty({ example: true })
  search!: boolean;

  @ApiProperty({ example: true })
  banned_spots!: boolean;

  @ApiProperty({ example: false })
  ugc!: boolean;

  @ApiProperty({ example: false })
  feedback!: boolean;
}

export class DataFreshnessDto {
  @ApiProperty({ example: 30 })
  core_days!: number;

  @ApiProperty({ example: 90 })
  normal_days!: number;
}

export class LegalConfigDto {
  @ApiProperty({ example: '2026-11-20' })
  terms_version!: string;

  @ApiProperty({ example: 'https://fish.unihuan.com/legal/terms' })
  terms_url!: string;

  @ApiProperty({ example: 'https://fish.unihuan.com/legal/privacy' })
  privacy_url!: string;

  @ApiProperty({ example: 'https://fish.unihuan.com/legal/community' })
  community_url!: string;
}

export class ClientConfigDto {
  @ApiProperty({ type: () => MapConfigDto })
  map!: MapConfigDto;

  @ApiProperty({ type: () => FeatureFlagsDto })
  features!: FeatureFlagsDto;

  @ApiProperty({ type: () => DataFreshnessDto })
  data_freshness!: DataFreshnessDto;

  @ApiProperty({ type: () => LegalConfigDto })
  legal!: LegalConfigDto;
}
