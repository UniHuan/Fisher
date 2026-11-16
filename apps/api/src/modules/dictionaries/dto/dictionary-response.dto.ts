import { ApiProperty } from '@nestjs/swagger';

export class PublicDictionaryItemDto {
  @ApiProperty({ example: 'food' })
  key!: string;

  @ApiProperty({ example: '餐饮' })
  label!: string;

  @ApiProperty({ example: 1 })
  sort_order!: number;
}

export class PublicDictionariesDto {
  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  districts!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  fish_types!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  fee_status!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  water_types!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  venue_types!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  fishing_methods!: PublicDictionaryItemDto[];

  @ApiProperty({ type: () => [PublicDictionaryItemDto] })
  poi_types!: PublicDictionaryItemDto[];
}

export class AdminDictionaryItemDto {
  @ApiProperty({ example: 'poi_type' })
  dict_type!: string;

  @ApiProperty({ example: 'food' })
  dict_key!: string;

  @ApiProperty({ example: '餐饮' })
  dict_label!: string;

  @ApiProperty({ example: 1 })
  sort_order!: number;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ nullable: true, example: null, type: String })
  parent_key!: string | null;
}

export class AdminDictionaryListDto {
  @ApiProperty({ type: () => [AdminDictionaryItemDto] })
  items!: AdminDictionaryItemDto[];
}
