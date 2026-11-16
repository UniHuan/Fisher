import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuditLogController],
  providers: [AuditLogRepository, AuditLogService],
  // The repository is exported so tests can simulate audit storage failures.
  exports: [AuditLogRepository, AuditLogService],
})
export class AuditLogModule {}
