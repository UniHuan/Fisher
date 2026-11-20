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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import { CurrentAppUser } from '../../common/decorators/current-app-user.decorator';
import { AppAuthGuard } from '../../common/guards/app-auth.guard';
import { OptionalAppAuthGuard } from '../../common/guards/optional-app-auth.guard';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { AppUserContext } from '../../common/types/request-context';
import {
  AbuseReportDto,
  AbuseReportResponseDto,
  DeleteReportResponseDto,
  ReportLikeResponseDto,
} from './dto/abuse-report.dto';
import { CreateReportDto, CreateReportResponseDto } from './dto/create-report.dto';
import { MyReportListQueryDto } from './dto/my-report-list-query.dto';
import { MyReportPageDto } from './dto/my-report-response.dto';
import { PublicReportPageDto } from './dto/public-report-response.dto';
import { ReportListQueryDto } from './dto/report-list-query.dto';
import { ReportsService } from './reports.service';

const SPOT_ID_PARAM = {
  name: 'spotId',
  description: 'Spot ULID',
  example: '01HX0000000000000000000000',
};

const REPORT_ID_PARAM = {
  name: 'id',
  description: 'Report ULID',
  example: '01HX0000000000000000000000',
};

const CREATE_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.SPOT_NOT_OPEN_FOR_UGC,
  ERROR_CODES.REPORT_FORBIDDEN,
  ERROR_CODES.USER_RESTRICTED,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.INTERNAL,
] as const;

const LIST_ERROR_CODES = [ERROR_CODES.VALIDATION, ERROR_CODES.INTERNAL] as const;

const ACTION_ERROR_CODES = [
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.REPORT_FORBIDDEN,
  ERROR_CODES.REPORT_NOT_FOUND,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.INTERNAL,
] as const;

const ABUSE_ERROR_CODES = [ERROR_CODES.VALIDATION, ...ACTION_ERROR_CODES] as const;

const DELETE_ERROR_CODES = [
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.REPORT_FORBIDDEN,
  ERROR_CODES.REPORT_NOT_FOUND,
  ERROR_CODES.INTERNAL,
] as const;

const MINE_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.INTERNAL,
] as const;

@ApiTags('reports')
@ApiClientHeaders()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Publish a text-only comment, catch or intel report',
    description:
      'Always returns 201; moderation_status tells the client whether the content was published, rejected or queued for review.',
  })
  @ApiEnvelopeResponse(CreateReportResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Report stored; the machine review outcome is in moderation_status',
  })
  @ApiCommonErrorResponses(CREATE_ERROR_CODES)
  create(
    @Body() body: CreateReportDto,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<CreateReportResponseDto> {
    return this.reports.create(body, user);
  }

  @Post('reports/:id/like')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Like a published report',
    description:
      'Idempotent: a repeated like returns the current count without inserting a second row. At most 60 like actions per user per minute.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(ReportLikeResponseDto, {
    status: HttpStatus.CREATED,
    description: 'The like exists and the current like count',
  })
  @ApiCommonErrorResponses(ACTION_ERROR_CODES)
  like(
    @Param('id') reportId: string,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<ReportLikeResponseDto> {
    return this.reports.like(reportId, user);
  }

  @Delete('reports/:id/like')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Remove a like from a published report',
    description:
      'Idempotent: removing a like that does not exist still returns the current count. Shares the 60 like actions per user per minute limit.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(ReportLikeResponseDto, {
    description: 'The like is gone and the current like count',
  })
  @ApiCommonErrorResponses(ACTION_ERROR_CODES)
  unlike(
    @Param('id') reportId: string,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<ReportLikeResponseDto> {
    return this.reports.unlike(reportId, user);
  }

  @Post('reports/:id/abuse')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Report published content for abuse',
    description:
      'Authors cannot report their own content. A duplicate report from the same user succeeds without a second row. At most 20 reports per user per day.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(AbuseReportResponseDto, {
    status: HttpStatus.CREATED,
    description: 'The abuse report was accepted (or already existed)',
  })
  @ApiCommonErrorResponses(ABUSE_ERROR_CODES)
  abuse(
    @Param('id') reportId: string,
    @Body() body: AbuseReportDto,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<AbuseReportResponseDto> {
    return this.reports.reportAbuse(reportId, body, user);
  }

  @Delete('reports/:id')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Delete own report',
    description:
      'Only the author may delete. Content and images are cleared immediately; a tombstone with the report id, author and timestamps remains for admin audit.',
  })
  @ApiParam(REPORT_ID_PARAM)
  @ApiEnvelopeResponse(DeleteReportResponseDto, {
    description: 'The report is tombstoned and no longer visible',
  })
  @ApiCommonErrorResponses(DELETE_ERROR_CODES)
  remove(
    @Param('id') reportId: string,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<DeleteReportResponseDto> {
    return this.reports.deleteReport(reportId, user);
  }

  @Get('reports/mine')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List the current user reports including pending and rejected' })
  @ApiEnvelopeResponse(MyReportPageDto, { description: 'The current user report page' })
  @ApiCommonErrorResponses(MINE_ERROR_CODES)
  mine(
    @Query() query: MyReportListQueryDto,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<MyReportPageDto> {
    return this.reports.listMine(query, user);
  }

  @Get('spots/:spotId/reports')
  @UseGuards(OptionalAppAuthGuard)
  @ApiOperation({
    summary: 'List published reports for a spot with type filters and cursor pagination',
  })
  @ApiParam(SPOT_ID_PARAM)
  @ApiEnvelopeResponse(PublicReportPageDto, {
    description: 'Visible reports, next cursor and total',
  })
  @ApiCommonErrorResponses(LIST_ERROR_CODES)
  list(
    @Param('spotId') spotId: string,
    @Query() query: ReportListQueryDto,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<PublicReportPageDto> {
    return this.reports.listPublic(spotId, query, user);
  }
}
