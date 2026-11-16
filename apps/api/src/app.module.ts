import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';
import { AdminAuthModule } from './modules/auth/admin-auth.module';
import { HealthController } from './modules/health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  // Built per application instance so tests can set process.env before Zod validation runs.
  static forRoot(): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validate: parseEnv,
        }),
        PrismaModule,
        AdminAuthModule,
      ],
      controllers: [HealthController],
    };
  }
}
