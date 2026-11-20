import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';
import { AdminSpotsModule } from './modules/admin-spots/admin-spots.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AppAuthModule } from './modules/app-auth/app-auth.module';
import { AdminAuthModule } from './modules/auth/admin-auth.module';
import { AuditLogModule } from './modules/audit/audit-log.module';
import { ClientConfigModule } from './modules/config/client-config.module';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module';
import { HealthController } from './modules/health/health.controller';
import { PoisModule } from './modules/pois/pois.module';
import { PublicSpotsModule } from './modules/public-spots/public-spots.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { WechatCallbackModule } from './modules/wechat-callback/wechat-callback.module';
import { PrismaModule } from './prisma/prisma.module';

export interface AppModuleOptions {
  /** Test-only provider overrides; production createApp passes nothing. */
  wechatAuthProvider?: Provider;
  contentSecurityProvider?: Provider;
}

@Module({})
export class AppModule {
  // Built per application instance so tests can set process.env before Zod validation runs.
  // extraControllers and options are test-only wiring; production createApp passes nothing.
  static forRoot(
    extraControllers: Type<unknown>[] = [],
    options: AppModuleOptions = {},
  ): DynamicModule {
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
        AppAuthModule.register({ wechatAuthProvider: options.wechatAuthProvider }),
        ReportsModule.register({
          contentSecurityProvider: options.contentSecurityProvider,
        }),
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
