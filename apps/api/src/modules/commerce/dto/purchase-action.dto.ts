import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PURCHASE_ACTION_TYPE } from '@szfisher/shared';

/** V1 allowlist. `qr` stays reserved for offline material. */
export const V1_PURCHASE_ACTION_TYPES: string[] = [
  PURCHASE_ACTION_TYPE.MINI_PROGRAM,
  PURCHASE_ACTION_TYPE.H5,
  PURCHASE_ACTION_TYPE.COPY_LINK,
];

export class PurchaseActionInputDto {
  @ApiProperty({
    enum: V1_PURCHASE_ACTION_TYPES,
    example: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
    description: 'Action type. V1 accepts mini_program, h5 and copy_link.',
  })
  type!: string;

  @ApiPropertyOptional({
    example: 'wx0123456789abcdef',
    description: 'WeChat mini program app id. Required for mini_program.',
  })
  app_id?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    example: '/pages/product/detail?id=1',
    description: 'Mini program path starting with /. Required for mini_program.',
  })
  path?: string;

  @ApiPropertyOptional({
    example: 'https://weidian.com/item.html?itemID=1',
    description: 'HTTPS fallback url for mini_program.',
  })
  fallback_url?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'https://weidian.com/item.html?itemID=1',
    description: 'HTTPS url. Required for h5 and copy_link.',
  })
  url?: string;

  @ApiPropertyOptional({
    example: '链接已复制',
    description: 'Toast copy shown after copy_link.',
  })
  toast?: string;
}

export class PurchaseActionDto {
  @ApiProperty({
    enum: V1_PURCHASE_ACTION_TYPES,
    example: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
  })
  type!: string;

  @ApiPropertyOptional({ example: 'wx0123456789abcdef' })
  app_id?: string;

  @ApiPropertyOptional({ example: '/pages/product/detail?id=1' })
  path?: string;

  @ApiPropertyOptional({ example: 'https://weidian.com/item.html?itemID=1' })
  fallback_url?: string;

  @ApiPropertyOptional({ example: 'https://weidian.com/item.html?itemID=1' })
  url?: string;

  @ApiPropertyOptional({ example: '链接已复制' })
  toast?: string;
}
