import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AdminReportsService } from './admin-reports.service';
import {
  AdminAbuseListQueryDto,
  AdminReportListQueryDto,
} from './dto/admin-report-list-query.dto';
import {
  AdminAbuseHandleResponseDto,
  AdminAbusePageDto,
  AdminReportActionDto,
  AdminReportHistoryDto,
  AdminReportItemDto,
  AdminReportPageDto,
  AdminReportSummaryDto,
  AdminUserBanResponseDto,
  AdminUserRestrictResponseDto,
} from './dto/admin-report-response.dto';
import { HandleAbuseDto } from './dto/handle-abuse.dto';
import { RejectReportDto } from './dto/reject-report.dto';
import { RemoveReportDto } from './dto/remove-report.dto';
import { BanUserDto, RestrictUserDto } from './dto/restrict-user.dto';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const REPORT_ID_PARAM = {
  name: 'id',
  description: 'Report ULID',
  example: '01HX0000000000000000000000',
};

const ABUSE_ID_PARAM = {
  name: 'id',
  description: 'Abuse report ULID',
  example: '01HX0000000000000000000000',
};

const USER_ID_PARAM = {
  name: 'id',
  description: 'App user ULID',
  example: '01HX0000000000000000000000',
};

const READ_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
] as const;

const MODERATE_ERROR_CODES = [
  ...READ_ERROR_CODES,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.REPORT_NOT_FOUND,
  ERROR_CODES.STATE_CONFLICT,
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
] as const;

const USER_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.STATE_CONFLICT,
  ERROR_CODES.INTERNAL,
] as const;

/**
 * Server-side enforcement for content moderation. `/admin/me` still returns the
 * `report:*` / `user:*` permission strings for UI shaping; these roles are the
 * authority. Reviewers moderate content but never restrict or ban users.
 */
@ApiTags('admin reports')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses(READ_ERROR_CODES)
@Controller('admin')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER)
@UseGuards(RolesGuard)
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List the moderation queue',
    description:
      'Queues are ordered oldest first. Images use public paths for visible content and signed work-bucket URLs otherwise.',
  })
  @ApiEnvelopeResponse(AdminReportPageDto, { description: 'Admin report queue page' })
  list(@Query() query: AdminReportListQueryDto): Promise<AdminReportPageDto> {
    return this.reports.listReports(query);
  }

  @Get('reports/summary')
  @ApiOperation({
    summary: 'Summarize queue, abuse and SLA counts',
    description: 'Counts power the admin navigation badge and the overdue backlog tag.',
  })
  @ApiEnvelopeResponse(AdminReportSummaryDto, { description: 'Moderation summary counts' })
  summary(): Promise<AdminReportSummaryDto> {
    return this.reports.summary();
  }

  @Get('reports/:id')
  @ApiOperation({
    summary: 'Read one report in queue-item shape',
    description:
      'Used by the abuse queue detail action so it can reuse the report drawer. Images follow the same public/signed rules as the queue.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(AdminReportItemDto, { description: 'One admin report item' })
  @ApiCommonErrorResponses([...READ_ERROR_CODES, ERROR_CODES.REPORT_NOT_FOUND])
  detail(@Param('id') reportId: string): Promise<AdminReportItemDto> {
    return this.reports.reportDetail(reportId);
  }

  @Get('reports/:id/history')
  @ApiOperation({
    summary: 'Read one report audit trail and its abuse reports',
    description:
      'Scoped to report:read so reviewers can inspect prior actions on the content they moderate. Returns actions, status transitions, reasons, actors and times; never content bodies, image URLs or reporter identities.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(AdminReportHistoryDto, {
    description: 'Report scoped audit and abuse history',
  })
  @ApiCommonErrorResponses([...READ_ERROR_CODES, ERROR_CODES.REPORT_NOT_FOUND])
  history(@Param('id') reportId: string): Promise<AdminReportHistoryDto> {
    return this.reports.reportHistory(reportId);
  }

  @Post('reports/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a published or machine-pending report',
    description:
      'Copies pending images to the published bucket and cancels pending media checks. Terminal states answer 409.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminReportActionDto, { description: 'Report set to human_approved' })
  @ApiCommonErrorResponses(MODERATE_ERROR_CODES)
  approve(
    @Param('id') reportId: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    return this.reports.approve(reportId, admin, request);
  }

  @Post('reports/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject content with a required reason',
    description:
      'Accepts published or machine-pending content, deletes published images and keeps work keys for the purge job.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminReportActionDto, { description: 'Report set to human_rejected' })
  @ApiCommonErrorResponses(MODERATE_ERROR_CODES)
  reject(
    @Param('id') reportId: string,
    @Body() body: RejectReportDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    return this.reports.reject(reportId, body.reason, admin, request);
  }

  @Post('reports/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove published content with a required reason',
    description:
      'Accepts published or human-approved content, deletes published images and keeps work keys for the purge job.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminReportActionDto, { description: 'Report set to removed' })
  @ApiCommonErrorResponses(MODERATE_ERROR_CODES)
  remove(
    @Param('id') reportId: string,
    @Body() body: RemoveReportDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    return this.reports.remove(reportId, body.reason, admin, request);
  }

  @Post('reports/:id/adopt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Adopt a publicly visible intel report',
    description: 'Sets adopted_at/adopted_by for intel only; other types answer 409.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminReportActionDto, { description: 'Intel report adopted' })
  @ApiCommonErrorResponses(MODERATE_ERROR_CODES)
  adopt(
    @Param('id') reportId: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminReportActionDto> {
    return this.reports.adopt(reportId, admin, request);
  }

  @Get('abuse-reports')
  @ApiOperation({
    summary: 'List abuse reports',
    description: 'Defaults to pending reports, ordered oldest first for the 24-hour SLA.',
  })
  @ApiEnvelopeResponse(AdminAbusePageDto, { description: 'Abuse report page' })
  listAbuses(@Query() query: AdminAbuseListQueryDto): Promise<AdminAbusePageDto> {
    return this.reports.listAbuses(query);
  }

  @Post('abuse-reports/:id/handle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle an abuse report',
    description:
      'remove takes the content down and marks every pending abuse of that content removed; dismiss keeps the content unchanged.',
  })
  @ApiParam(ABUSE_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminAbuseHandleResponseDto, { description: 'Abuse report handled' })
  @ApiCommonErrorResponses(MODERATE_ERROR_CODES)
  handleAbuse(
    @Param('id') abuseId: string,
    @Body() body: HandleAbuseDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminAbuseHandleResponseDto> {
    return this.reports.handleAbuse(abuseId, body, admin, request);
  }

  @Post('users/:id/restrict')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restrict publishing for 1 to 30 days',
    description: 'Does not revoke sessions or hide existing content; browsing and likes still work.',
  })
  @ApiParam(USER_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminUserRestrictResponseDto, { description: 'Restriction applied' })
  @ApiCommonErrorResponses(USER_ERROR_CODES)
  restrictUser(
    @Param('id') userId: string,
    @Body() body: RestrictUserDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminUserRestrictResponseDto> {
    return this.reports.restrictUser(userId, body, admin, request);
  }

  @Delete('users/:id/restrict')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lift a publishing restriction',
    description: 'Clears restricted_until so the user can publish immediately.',
  })
  @ApiParam(USER_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminUserRestrictResponseDto, { description: 'Restriction lifted' })
  @ApiCommonErrorResponses(USER_ERROR_CODES)
  unrestrictUser(
    @Param('id') userId: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminUserRestrictResponseDto> {
    return this.reports.unrestrictUser(userId, admin, request);
  }

  @Post('users/:id/ban')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ban a user and take down their visible content',
    description:
      'Sets banned, clears any restriction, revokes sessions, increments token_version and removes visible reports with reason user_banned.',
  })
  @ApiParam(USER_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminUserBanResponseDto, { description: 'User banned' })
  @ApiCommonErrorResponses(USER_ERROR_CODES)
  banUser(
    @Param('id') userId: string,
    @Body() body: BanUserDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminUserBanResponseDto> {
    return this.reports.banUser(userId, body, admin, request);
  }

  @Post('users/:id/unban')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unban a user without restoring removed content',
    description: 'Sets active and increments token_version again so old tokens stay invalid.',
  })
  @ApiParam(USER_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminUserBanResponseDto, { description: 'User unbanned' })
  @ApiCommonErrorResponses(USER_ERROR_CODES)
  unbanUser(
    @Param('id') userId: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminUserBanResponseDto> {
    return this.reports.unbanUser(userId, admin, request);
  }
}
