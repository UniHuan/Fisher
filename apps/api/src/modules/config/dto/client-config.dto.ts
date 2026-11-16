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
}

export class DataFreshnessDto {
  @ApiProperty({ example: 30 })
  core_days!: number;

  @ApiProperty({ example: 90 })
  normal_days!: number;
}

export class ClientConfigDto {
  @ApiProperty({ type: () => MapConfigDto })
  map!: MapConfigDto;

  @ApiProperty({ type: () => FeatureFlagsDto })
  features!: FeatureFlagsDto;

  @ApiProperty({ type: () => DataFreshnessDto })
  data_freshness!: DataFreshnessDto;
}
