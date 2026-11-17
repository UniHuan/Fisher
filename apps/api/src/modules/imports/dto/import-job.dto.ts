import { ApiProperty } from '@nestjs/swagger';

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export class ImportJobDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  job_id!: string;

  @ApiProperty({
    enum: ['pending', 'processing', 'completed', 'failed'],
    example: 'completed',
  })
  status!: ImportJobStatus;

  @ApiProperty({ type: 'integer', example: 100 })
  total_rows!: number;

  @ApiProperty({ type: 'integer', example: 97 })
  success_rows!: number;

  @ApiProperty({ type: 'integer', example: 3 })
  failed_rows!: number;

  @ApiProperty({ example: true })
  has_error_report!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '/api/v1/admin/imports/01HX.../errors' })
  error_report_url!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finished_at!: string | null;
}
