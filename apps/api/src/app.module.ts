import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';
import { AdminSpotsModule } from './modules/admin-spots/admin-spots.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminAuthModule } from './modules/auth/admin-auth.module';
import { AuditLogModule } from './modules/audit/audit-log.module';
import { ClientConfigModule } from './modules/config/client-config.module';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module';
import { HealthController } from './modules/health/health.controller';
import { PoisModule } from './modules/pois/pois.module';
import { PublicSpotsModule } from './modules/public-spots/public-spots.module';
import { StorageModule } from './modules/storage/storage.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { WechatCallbackModule } from './modules/wechat-callback/wechat-callback.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  // Built per application instance so tests can set process.env before Zod validation runs.
  // extraControllers is test-only wiring; production createApp passes nothing.
  static forRoot(extraControllers: Type<unknown>[] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validate: parseEnv,
        }),
        PrismaModule,
        AnalyticsModule,
        AdminAuthModule,
        AuditLogModule,
        DictionariesModule,
        AdminSpotsModule,
        ClientConfigModule,
        PublicSpotsModule,
        PoisModule,
        StorageModule,
        UploadsModule,
        WechatCallbackModule,
      ],
      controllers: [HealthController, ...extraControllers],
    };
  }
}
