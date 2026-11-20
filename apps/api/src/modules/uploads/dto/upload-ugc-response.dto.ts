import { ApiProperty } from '@nestjs/swagger';

export class UploadUgcResponseDto {
  @ApiProperty({ example: 'ugc/01HX0000000000000000000000/01HX0000000000000000000001.webp' })
  key!: string;

  @ApiProperty({ type: 'integer', example: 1280 })
  width!: number;

  @ApiProperty({ type: 'integer', example: 960 })
  height!: number;

  @ApiProperty({ type: 'integer', example: 182400 })
  size_bytes!: number;
}
