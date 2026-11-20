import {
  Body,
  Controller,
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
