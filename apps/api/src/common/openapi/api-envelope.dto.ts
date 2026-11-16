import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';

const ERROR_CODE_VALUES = Object.values(ERROR_CODES).filter(
  (code) => code !== ERROR_CODES.SUCCESS,
);

export class ApiValidationIssueDto {
  @ApiProperty({ example: 'dict_key' })
  field!: string;

  @ApiProperty({ example: 'dict_key must be longer than or equal to 1 characters' })
  message!: string;
}

/** Shared success-envelope fields from PRD 10.4. */
export class ApiEnvelopeBaseDto {
  @ApiProperty({ example: ERROR_CODES.SUCCESS, description: 'Business code; 0 means success' })
  code!: number;

  @ApiProperty({ example: 'ok' })
  message!: string;

  @ApiProperty({ example: 'req_01HX0000000000000000000000' })
  request_id!: string;
}

/** Documented envelope component; responses refine `data` with the concrete DTO. */
export class ApiEnvelopeDto extends ApiEnvelopeBaseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Operation payload; its shape is documented per endpoint',
  })
  data!: unknown;
}

/** Failure envelope from PRD 10.4; `data` is always null. */
export class ApiErrorEnvelopeDto {
  @ApiProperty({
    enum: ERROR_CODE_VALUES,
    example: ERROR_CODES.VALIDATION,
    description: 'Stable business error code',
  })
  code!: number;

  @ApiProperty({ example: 'Bad request' })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'Always null for failures',
  })
  data!: null;

  @ApiProperty({ example: 'req_01HX0000000000000000000000' })
  request_id!: string;

  @ApiPropertyOptional({
    type: () => [ApiValidationIssueDto],
    description: 'Field-level validation details when available',
  })
  details?: ApiValidationIssueDto[];
}
