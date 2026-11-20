import { ApiProperty } from '@nestjs/swagger';
import { FEEDBACK_STATUS } from '@szfisher/shared';

const STATUSES: readonly string[] = Object.values(FEEDBACK_STATUS);

export class UploadFeedbackImageResponseDto {
  @ApiProperty({ example: 'feedback/01HX0000000000000000000000/01HX0000000000000000000001.webp' })
  key!: string;

  @ApiProperty({ type: 'integer', example: 1200 })
  width!: number;

  @ApiProperty({ type: 'integer', example: 900 })
  height!: number;

  @ApiProperty({ type: 'integer', example: 182734 })
  size_bytes!: number;
}

export class CreateFeedbackResponseDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  feedback_id!: string;

  @ApiProperty({ enum: STATUSES, example: 'open' })
  status!: string;
}
