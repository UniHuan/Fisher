import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLE, ERROR_CODES, type Paginated } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext } from '../../common/types/request-context';
import { AuditLogService, type AuditLogItem } from './audit-log.service';
import { AuditLogPageDto } from './dto/audit-log-response.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

// PRD 8.1: super admins read all logs, operators read their own, reviewers have no access.
@ApiTags('audit')
@ApiCookieAuth('admin-cookie')
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/audit-logs')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  @ApiEnvelopeResponse(AuditLogPageDto, { description: 'Paginated audit log rows' })
  list(
    @Query() query: AuditLogQueryDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<Paginated<AuditLogItem>> {
    return this.auditLogs.list(admin, query);
  }
}
