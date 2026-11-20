import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { ClientConfigModule } from '../config/client-config.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { StorageModule } from '../storage/storage.module';
import { ImageProcessorService } from './image-processor.service';
import { PreviewSignerService } from './preview-signer.service';
import { UploadsController } from './uploads.controller';
import { UploadsPublicController } from './uploads.public.controller';
import { UploadsUgcController } from './uploads.ugc.controller';
import { UploadsUgcService } from './uploads.ugc.service';
import { UploadsService } from './uploads.service';

@Module({
  imports: [
    AdminAuthModule,
    AuditLogModule,
    ClientConfigModule,
    RateLimitModule,
    StorageModule,
  ],
  controllers: [UploadsController, UploadsPublicController, UploadsUgcController],
  providers: [
    UploadsService,
    UploadsUgcService,
    ImageProcessorService,
    PreviewSignerService,
  ],
  exports: [ImageProcessorService, PreviewSignerService],
})
export class UploadsModule {}
