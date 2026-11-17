import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { UploadsController } from './uploads.controller';
import { UploadsPublicController } from './uploads.public.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AdminAuthModule, AuditLogModule, StorageModule],
  controllers: [UploadsController, UploadsPublicController],
  providers: [UploadsService],
})
export class UploadsModule {}
