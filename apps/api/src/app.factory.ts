import { ValidationPipe, type INestApplication, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JsonLogger } from './common/logging/json-logger';
import { accessLogMiddleware } from './common/middleware/access-log.middleware';
import { CacheControlMiddleware } from './common/middleware/cache-control.middleware';
import { ClientContextMiddleware } from './common/middleware/client-context.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

const BODY_LIMIT = '2mb';

export async function createApp(extraControllers: Type<unknown>[] = []): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(extraControllers), {
    bodyParser: false,
    logger: new JsonLogger(),
  });
  const adminOrigins = app.get(ConfigService).getOrThrow<string[]>('ADMIN_ORIGINS');

  // Request IDs must run before body parsing so parser errors still carry one.
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  app.use(accessLogMiddleware);

  // no-store default; public dictionary/config controllers override it for their payload.
  const cacheControlMiddleware = new CacheControlMiddleware();
  app.use(cacheControlMiddleware.use.bind(cacheControlMiddleware));

  app.enableCors({
    origin: adminOrigins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Client-Type',
      'X-Client-Version',
    ],
    exposedHeaders: ['X-Request-Id', 'ETag', 'Cache-Control'],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  app.use(cookieParser());
  app.use(helmet());

  const clientContextMiddleware = new ClientContextMiddleware();
  app.use(clientContextMiddleware.use.bind(clientContextMiddleware));

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}
