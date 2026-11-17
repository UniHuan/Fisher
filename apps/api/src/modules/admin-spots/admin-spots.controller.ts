import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
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
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { ImportJobDto } from '../imports/dto/import-job.dto';
import { ImportsService, type UploadedImportFile } from '../imports/imports.service';
import { AdminSpotsService } from './admin-spots.service';
import { AdminSpotListQueryDto } from './dto/admin-spot-list-query.dto';
import {
  AdminSpotDeleteResponseDto,
  AdminSpotDetailDto,
  AdminSpotPageDto,
  AdminSpotWriteResponseDto,
} from './dto/admin-spot-response.dto';
import { CreateSpotDto } from './dto/create-spot.dto';
import { UpdateSpotDto } from './dto/update-spot.dto';
import { VerifySpotDto } from './dto/verify-spot.dto';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description: 'Optional 24-hour idempotency key for publish and offline',
};

const SPOT_ID_PARAM = {
  name: 'id',
  description: 'Spot ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('admin spots')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/spots')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER)
@UseGuards(RolesGuard)
export class AdminSpotsController {
  constructor(
    private readonly spots: AdminSpotsService,
    private readonly imports: ImportsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List spots for admin management' })
  @ApiEnvelopeResponse(AdminSpotPageDto, { description: 'Paginated admin spot rows' })
  list(@Query() query: AdminSpotListQueryDto) {
    return this.spots.list(query);
  }

  @Get('import-template')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Download the Excel import template' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: HttpStatus.OK, description: 'Excel template' })
  async importTemplate(@Res() response: Response): Promise<void> {
    const buffer = await this.imports.getTemplate();
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="spot-import-template.xlsx"',
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(buffer);
  }

  @Post('import')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Upload an Excel import and create draft spots asynchronously' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(ImportJobDto, {
    status: HttpStatus.CREATED,
    description: 'Import job created; poll the job endpoint for progress',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'Invalid Excel or too many rows (40001)')
  @ApiErrorResponse(HttpStatus.PAYLOAD_TOO_LARGE, 'Import file exceeds 20 MB (41301)')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'Import storage unavailable (50301)')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  importSpots(
    @UploadedFile() file: UploadedImportFile | undefined,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.imports.upload(file, admin, request);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one spot, including drafts and offline rows' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiEnvelopeResponse(AdminSpotDetailDto, { description: 'Admin spot detail' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  detail(@Param('id') id: string) {
    return this.spots.getById(id);
  }

  @Post()
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Create a spot draft' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotWriteResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Created draft and duplicate warnings',
  })
  create(
    @Body() body: CreateSpotDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.create(body, admin, request);
  }

  @Put(':id')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Update a draft or published spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotWriteResponseDto, {
    description: 'Updated spot and duplicate warnings',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'Spot changed concurrently (40901)')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'Published invariant would be broken (42201)')
  update(
    @Param('id') id: string,
    @Body() body: UpdateSpotDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.update(id, body, admin, request);
  }

  @Delete(':id')
  @Roles(ADMIN_ROLE.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a draft or offline spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotDeleteResponseDto, { description: 'Spot soft-deleted' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'Published spot cannot be deleted (40901)')
  remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.delete(id, admin, request);
  }

  @Post(':id/publish')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a draft or offline spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiEnvelopeResponse(AdminSpotDetailDto, { description: 'Published spot' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'State or idempotency conflict (40901/40902)')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'Publish validation failed (42201)')
  publish(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.publish(id, admin, request, idempotencyKey);
  }

  @Post(':id/offline')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a published spot offline' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiEnvelopeResponse(AdminSpotDetailDto, { description: 'Offline spot' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'State or idempotency conflict (40901/40902)')
  offline(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.offline(id, admin, request, idempotencyKey);
  }

  @Post(':id/verify')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a spot verified' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotDetailDto, { description: 'Verified spot' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  verify(
    @Param('id') id: string,
    @Body() body: VerifySpotDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.spots.verify(id, body, admin, request);
  }
}
