import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ADMIN_ROLE, type Paginated } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AdminContext } from '../../common/types/request-context';
import { AuditLogService, type AuditLogItem } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

// PRD 8.1: super admins read all logs, operators read their own, reviewers have no access.
@Controller('admin/audit-logs')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
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
