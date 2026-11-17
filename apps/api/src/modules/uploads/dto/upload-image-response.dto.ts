import { ApiProperty } from '@nestjs/swagger';
import { UPLOAD_PURPOSES } from './upload-image.dto';

export class UploadImageResponseDto {
  @ApiProperty({ example: 'spots/01HX0000000000000000000000/01HX0000000000000000000001.webp' })
  key!: string;

  @ApiProperty({ example: '/api/v1/uploads/preview?key=...&expires=...&signature=...' })
  preview_url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expires_at!: string;

  @ApiProperty({ type: 'integer', example: 1600 })
  width!: number;

  @ApiProperty({ type: 'integer', example: 1067 })
  height!: number;

  @ApiProperty({ type: 'integer', example: 184320 })
  size_bytes!: number;

  @ApiProperty({ enum: UPLOAD_PURPOSES, example: 'detail' })
  purpose!: string;
}
