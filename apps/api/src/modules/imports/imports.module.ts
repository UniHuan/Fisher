import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { StorageModule } from '../storage/storage.module';
import { ImportWorker } from './import-worker.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [AdminAuthModule, AuditLogModule, DictionariesModule, StorageModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportWorker],
  exports: [ImportsService],
})
export class ImportsModule {}
