import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AdminPoiListQueryDto,
  BindPoiDto,
  CreatePoiDto,
  UpdatePoiDto,
} from './dto/admin-poi.dto';
import {
  AdminPoiItemDto,
  AdminPoiPageDto,
  AdminSpotPoiItemDto,
  AdminSpotPoiListDto,
  AdminSpotPoiUnbindDto,
  PoiSyncRunDto,
} from './dto/admin-poi-response.dto';
import { PoisService } from './pois.service';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const SPOT_ID_PARAM = {
  name: 'id',
  description: 'Spot ULID',
  example: '01HX0000000000000000000000',
};

const POI_ID_PARAM = {
  name: 'poi_id',
  description: 'POI ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('admin pois')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER)
@UseGuards(RolesGuard)
export class PoisController {
  constructor(private readonly pois: PoisService) {}

  @Get('pois')
  @ApiOperation({ summary: 'List POIs in the shared POI library' })
  @ApiEnvelopeResponse(AdminPoiPageDto, { description: 'Paginated POI rows' })
  list(@Query() query: AdminPoiListQueryDto) {
    return this.pois.list(query);
  }

  @Post('pois')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Create a manually entered POI' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminPoiItemDto, {
    status: HttpStatus.CREATED,
    description: 'Created POI',
  })
  create(
    @Body() body: CreatePoiDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.pois.create(body, admin, request);
  }

  @Put('pois/:id')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Correct or hide a POI' })
  @ApiParam({ name: 'id', description: 'POI ULID', example: '01HX0000000000000000000000' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminPoiItemDto, { description: 'Updated POI' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'POI does not exist (40401)')
  update(
    @Param('id') id: string,
    @Body() body: UpdatePoiDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.pois.update(id, body, admin, request);
  }

  @Get('spots/:id/pois')
  @ApiOperation({ summary: 'List a spot POI bindings, including hidden POIs and last sync' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiEnvelopeResponse(AdminSpotPoiListDto, { description: 'Spot POI bindings' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  listSpotPois(@Param('id') id: string) {
    return this.pois.listSpotPois(id);
  }

  @Post('spots/:id/pois')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @ApiOperation({ summary: 'Bind an existing POI to a spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotPoiItemDto, {
    status: HttpStatus.CREATED,
    description: 'Created POI binding',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot or POI does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'POI is already bound (40901)')
  bind(
    @Param('id') id: string,
    @Body() body: BindPoiDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.pois.bind(id, body, admin, request);
  }

  @Delete('spots/:id/pois/:poi_id')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unbind a POI from a spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiParam(POI_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminSpotPoiUnbindDto, { description: 'POI unbound' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot or binding does not exist (40401)')
  unbind(
    @Param('id') id: string,
    @Param('poi_id') poiId: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.pois.unbind(id, poiId, admin, request);
  }

  @Post('spots/:id/pois/sync')
  @Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync nearby POIs from the configured provider' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(PoiSyncRunDto, { description: 'Finished POI sync run' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'POI provider unavailable (50301)')
  sync(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.pois.sync(id, admin, request);
  }
}
