import { ApiProperty } from '@nestjs/swagger';

/** Health and readiness are outside /api/v1, so they keep the raw status body. */
export class HealthStatusDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}
