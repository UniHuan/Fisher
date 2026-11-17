import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { StorageModule } from '../storage/storage.module';
import { AdminSpotsController } from './admin-spots.controller';
import { AdminSpotsRepository } from './admin-spots.repository';
import { AdminSpotsService } from './admin-spots.service';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [AdminAuthModule, AuditLogModule, DictionariesModule, StorageModule],
  controllers: [AdminSpotsController],
  providers: [AdminSpotsRepository, AdminSpotsService, IdempotencyService],
})
export class AdminSpotsModule {}
