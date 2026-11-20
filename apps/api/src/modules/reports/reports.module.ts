import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClientConfigModule } from '../config/client-config.module';
import { ContentSecurityModule } from '../content-security/content-security.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { StorageModule } from '../storage/storage.module';
// UploadsModule exports the preview signer used for author-only image URLs.
import { UploadsModule } from '../uploads/uploads.module';
import { ReportModerationService } from './report-moderation.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

export interface ReportsModuleOptions {
  /** Test-only content security override, forwarded to ContentSecurityModule. */
  contentSecurityProvider?: Provider;
}

@Module({})
export class ReportsModule {
  static register(options: ReportsModuleOptions = {}): DynamicModule {
    return {
      module: ReportsModule,
      imports: [
        PrismaModule,
        ClientConfigModule,
        DictionariesModule,
        RateLimitModule,
        StorageModule,
        UploadsModule,
        // AppAuthModule is global (registered once at the root with the test
        // auth provider), so the guards resolve AppAuthService from there.
        ContentSecurityModule.register({
          contentSecurityProvider: options.contentSecurityProvider,
        }),
      ],
      controllers: [ReportsController],
      providers: [ReportsService, ReportsRepository, ReportModerationService],
      exports: [ReportsService, ReportsRepository, ReportModerationService],
    };
  }
}
