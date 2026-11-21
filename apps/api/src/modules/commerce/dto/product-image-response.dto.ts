import { ApiProperty } from '@nestjs/swagger';

export class ProductImageResponseDto {
  @ApiProperty({ example: 'products/01HX0000000000000000000000/01HX0000000000000000000001.webp' })
  key!: string;

  @ApiProperty({ example: '/api/v1/uploads/preview?key=...&area=working&expires=...&signature=...' })
  preview_url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expires_at!: string;

  @ApiProperty({ type: 'integer', example: 900 })
  width!: number;

  @ApiProperty({ type: 'integer', example: 600 })
  height!: number;

  @ApiProperty({ type: 'integer', example: 122880 })
  size_bytes!: number;
}
