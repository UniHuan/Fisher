import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { CLIENT_TYPE } from '@szfisher/shared';

const CLIENT_TYPES: readonly string[] = Object.values(CLIENT_TYPE);

/**
 * Documents the required client-context headers enforced for every /api/v1 route by
 * ClientContextMiddleware. Apply per controller so the generated contract carries them.
 */
export function ApiClientHeaders(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'X-Client-Type',
      required: true,
      description: 'Client platform; the request is rejected when missing or unknown',
      schema: { type: 'string', enum: [...CLIENT_TYPES], example: 'admin' },
    }),
    ApiHeader({
      name: 'X-Client-Version',
      required: true,
      description: 'Client build version; required on every /api/v1 request',
      schema: { type: 'string', example: '1.0.0' },
    }),
  );
}
