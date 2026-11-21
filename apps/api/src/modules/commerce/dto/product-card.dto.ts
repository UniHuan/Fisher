import { ApiProperty } from '@nestjs/swagger';
import { PRODUCT_CATEGORY } from '@szfisher/shared';
import { PurchaseActionDto } from './purchase-action.dto';

export class ProductChannelCardDto {
  @ApiProperty({ example: 'weidian' })
  channel!: string;

  @ApiProperty({ example: '微店' })
  label!: string;

  @ApiProperty({ type: String, nullable: true, example: '¥299 起' })
  price_display!: string | null;

  @ApiProperty({ type: () => PurchaseActionDto })
  purchase_action!: PurchaseActionDto;
}

export class ProductCardDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  product_id!: string;

  @ApiProperty({ example: 'UniHuan 轻量路亚竿' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: '深圳湾岸钓适用' })
  subtitle!: string | null;

  @ApiProperty({ enum: Object.values(PRODUCT_CATEGORY), example: PRODUCT_CATEGORY.ROD })
  category!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/api/v1/uploads/public/products/01HX0000000000000000000000/01HX0000000000000000000001.webp',
  })
  image_url!: string | null;

  @ApiProperty({ type: () => [ProductChannelCardDto] })
  channels!: ProductChannelCardDto[];
}

export class ProductCardListDto {
  @ApiProperty({ type: () => [ProductCardDto] })
  items!: ProductCardDto[];
}
