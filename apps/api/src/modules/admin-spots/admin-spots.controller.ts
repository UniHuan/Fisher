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
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
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
  constructor(private readonly spots: AdminSpotsService) {}

  @Get()
  @ApiOperation({ summary: 'List spots for admin management' })
  @ApiEnvelopeResponse(AdminSpotPageDto, { description: 'Paginated admin spot rows' })
  list(@Query() query: AdminSpotListQueryDto) {
    return this.spots.list(query);
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
