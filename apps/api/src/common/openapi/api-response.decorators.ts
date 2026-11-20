import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import {
  ApiEnvelopeBaseDto,
  ApiEnvelopeDto,
  ApiErrorEnvelopeDto,
  ApiValidationIssueDto,
} from './api-envelope.dto';

export interface EnvelopeResponseOptions {
  status?: number;
  description?: string;
  isArray?: boolean;
}

const DEFAULT_SUCCESS_STATUS = 200;

function envelopeSchema(dataSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    allOf: [
      { $ref: getSchemaPath(ApiEnvelopeBaseDto) },
      { required: ['data'], properties: { data: dataSchema } },
    ],
  };
}

function extraModels(...models: Type<unknown>[]): Type<unknown>[] {
  return [ApiEnvelopeBaseDto, ApiEnvelopeDto, ApiErrorEnvelopeDto, ApiValidationIssueDto, ...models];
}

/** Documents a failure envelope for a status that is not part of the common set. */
export function ApiErrorResponse(
  status: number,
  description: string,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorEnvelopeDto),
    ApiResponse({
      status,
      description,
      schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
    }),
  );
}

/** Documents `{code,message,data,request_id}` with `data` referencing the concrete DTO. */
export function ApiEnvelopeResponse(
  model: Type<unknown> | null,
  options: EnvelopeResponseOptions = {},
): MethodDecorator & ClassDecorator {
  const status = options.status ?? DEFAULT_SUCCESS_STATUS;
  const description = options.description ?? 'Success';

  if (model === null) {
    return applyDecorators(
      ApiExtraModels(...extraModels()),
      ApiResponse({
        status,
        description,
        schema: envelopeSchema({ nullable: true, example: null }),
      }),
    );
  }

  return applyDecorators(
    ApiExtraModels(...extraModels(model)),
    ApiResponse({
      status,
      description,
      schema: envelopeSchema(
        options.isArray
          ? { type: 'array', items: { $ref: getSchemaPath(model) } }
          : { $ref: getSchemaPath(model) },
      ),
    }),
  );
}

/** Login returns one of three documented shapes in the same envelope. */
export function ApiEnvelopeUnionResponse(
  models: Type<unknown>[],
  options: EnvelopeResponseOptions = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(...extraModels(...models)),
    ApiResponse({
      status: options.status ?? DEFAULT_SUCCESS_STATUS,
      description: options.description ?? 'Success',
      schema: envelopeSchema({
        oneOf: models.map((model) => ({ $ref: getSchemaPath(model) })),
      }),
    }),
  );
}

const COMMON_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.STATE_CONFLICT,
  ERROR_CODES.PAYLOAD_TOO_LARGE,
  ERROR_CODES.PUBLISH_VALIDATION,
  ERROR_CODES.INTERNAL,
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
] as const;

const ERROR_RESPONSE: Record<number, { status: number; label: string }> = {
  [ERROR_CODES.VALIDATION]: { status: 400, label: 'Bad request' },
  [ERROR_CODES.UNAUTHENTICATED]: { status: 401, label: 'Authentication required' },
  [ERROR_CODES.TOKEN_EXPIRED]: { status: 401, label: 'Token expired' },
  [ERROR_CODES.FORBIDDEN]: { status: 403, label: 'Forbidden' },
  [ERROR_CODES.FEATURE_DISABLED]: { status: 403, label: 'Forbidden' },
  [ERROR_CODES.SPOT_NOT_OPEN_FOR_UGC]: { status: 403, label: 'Forbidden' },
  [ERROR_CODES.REPORT_FORBIDDEN]: { status: 403, label: 'Forbidden' },
  [ERROR_CODES.USER_RESTRICTED]: { status: 403, label: 'Forbidden' },
  [ERROR_CODES.NOT_FOUND]: { status: 404, label: 'Not found' },
  [ERROR_CODES.REPORT_NOT_FOUND]: { status: 404, label: 'Not found' },
  [ERROR_CODES.STATE_CONFLICT]: { status: 409, label: 'State conflict' },
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: { status: 413, label: 'Payload too large' },
  [ERROR_CODES.PUBLISH_VALIDATION]: { status: 422, label: 'Business validation failed' },
  [ERROR_CODES.RATE_LIMITED]: { status: 429, label: 'Too many requests' },
  [ERROR_CODES.INTERNAL]: { status: 500, label: 'Internal server error' },
  [ERROR_CODES.DEPENDENCY_UNAVAILABLE]: { status: 503, label: 'Dependency unavailable' },
};

/**
 * Documents the common failure envelope for the selected business codes.
 * Codes sharing an HTTP status are merged into a single response entry.
 */
export function ApiCommonErrorResponses(
  codes: readonly number[] = COMMON_ERROR_CODES,
): MethodDecorator & ClassDecorator {
  const grouped = new Map<number, { codes: number[]; label: string }>();
  for (const code of codes) {
    const entry = ERROR_RESPONSE[code];
    if (entry === undefined) {
      continue;
    }
    const existing = grouped.get(entry.status);
    if (existing === undefined) {
      grouped.set(entry.status, { codes: [code], label: entry.label });
    } else {
      existing.codes.push(code);
    }
  }

  const responses = Array.from(grouped.entries()).map(([status, entry]) =>
    ApiResponse({
      status,
      description: `${entry.label} (${entry.codes.join(', ')})`,
      schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
    }),
  );

  return applyDecorators(ApiExtraModels(...extraModels()), ...responses);
}
