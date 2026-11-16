import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export const OPENAPI_TITLE = 'SZFisher API';
export const OPENAPI_VERSION = '1.0.0';

/**
 * Builds the OpenAPI contract served as the single source of truth (PRD 10.4).
 * The generated document is committed under openapi/openapi.yaml.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(OPENAPI_TITLE)
    .setDescription('Shenzhen fishing assistant API. Base path: /api/v1.')
    .setVersion(OPENAPI_VERSION)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addCookieAuth('__Host-fish_access', { type: 'apiKey', in: 'cookie' }, 'admin-cookie')
    .addTag('public', 'Public client endpoints')
    .addTag('admin auth', 'Admin authentication and sessions')
    .addTag('admin dictionaries', 'Super-admin dictionary maintenance')
    .addTag('audit', 'Audit log queries')
    .addTag('config', 'Client configuration whitelist')
    .build();

  return SwaggerModule.createDocument(app, config);
}
