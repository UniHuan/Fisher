import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { AdminDictionariesController } from './admin-dictionaries.controller';
import { DictionariesController } from './dictionaries.controller';
import { DictionariesRepository } from './dictionaries.repository';
import { DictionariesService } from './dictionaries.service';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule],
  controllers: [DictionariesController, AdminDictionariesController],
  providers: [DictionariesRepository, DictionariesService],
  // Admin spot validation reuses the same enabled dictionary rows.
  exports: [DictionariesRepository],
})
export class DictionariesModule {}
