import { Controller, Get, Query } from '@nestjs/common';
import type { Paginated } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import type { AdminContext } from '../../common/types/request-context';
import { AuditLogService, type AuditLogItem } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  list(
    @Query() query: AuditLogQueryDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<Paginated<AuditLogItem>> {
    return this.auditLogs.list(admin, query);
  }
}
