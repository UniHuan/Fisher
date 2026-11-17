import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

export const UPLOAD_PURPOSES = ['cover', 'detail'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export class UploadImageDto {
  @ApiProperty({ minLength: 26, maxLength: 26, example: '01HX0000000000000000000000' })
  @IsString()
  @Length(26, 26)
  spot_id!: string;

  @ApiProperty({ enum: UPLOAD_PURPOSES, example: 'detail' })
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;
}
