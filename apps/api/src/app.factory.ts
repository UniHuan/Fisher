import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ClientContextMiddleware } from './common/middleware/client-context.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { parseEnv } from './config/env.schema';

export async function createApp(): Promise<INestApplication> {
  const env = parseEnv(process.env);
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.use(helmet());

  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));

  app.enableCors({
    origin: env.ADMIN_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Client-Type',
      'X-Client-Version',
    ],
    maxAge: 600,
  });

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
