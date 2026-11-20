import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsRepository } from './admin-reports.repository';
import { AdminReportsService } from './admin-reports.service';

@Module({
  imports: [AdminAuthModule, AuditLogModule, StorageModule, UploadsModule],
  controllers: [AdminReportsController],
  providers: [AdminReportsRepository, AdminReportsService],
})
export class AdminReportsModule {}
