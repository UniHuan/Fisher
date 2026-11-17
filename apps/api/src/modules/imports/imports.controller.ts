import { Controller, Get, HttpStatus, Param, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext } from '../../common/types/request-context';
import { ImportJobDto } from './dto/import-job.dto';
import { ImportsService } from './imports.service';

const JOB_ID_PARAM = {
  name: 'id',
  description: 'Import job ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('admin imports')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/imports')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get an import job status and counts' })
  @ApiParam(JOB_ID_PARAM)
  @ApiEnvelopeResponse(ImportJobDto, { description: 'Import job status' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Import job does not exist (40401)')
  job(@Param('id') id: string, @CurrentAdmin() admin: AdminContext) {
    return this.imports.getJob(id, admin);
  }

  @Get(':id/errors')
  @ApiOperation({ summary: 'Download the import error and warning CSV' })
  @ApiParam(JOB_ID_PARAM)
  @ApiProduces('text/csv')
  @ApiResponse({ status: HttpStatus.OK, description: 'CSV report' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Import or report does not exist (40401)')
  async errors(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.imports.getErrors(id, admin);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(report.buffer);
  }
}
