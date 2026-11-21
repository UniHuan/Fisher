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
  AdminPlacementDeleteDto,
  AdminPlacementItemDto,
  AdminPlacementListDto,
  AdminPlacementListQueryDto,
} from './dto/admin-placement.dto';
import { CreatePlacementDto } from './dto/create-placement.dto';
import { UpdatePlacementDto } from './dto/update-placement.dto';
import { PlacementService } from './placement.service';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const PLACEMENT_ID_PARAM = {
  name: 'id',
  description: 'Placement ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('admin product placements')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/product-placements')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
export class AdminPlacementController {
  constructor(private readonly placements: PlacementService) {}

  @Get()
  @ApiOperation({ summary: 'List product placements for admin management' })
  @ApiEnvelopeResponse(AdminPlacementListDto, { description: 'Paginated placement rows' })
  list(@Query() query: AdminPlacementListQueryDto) {
    return this.placements.listAdmin(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product placement' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminPlacementItemDto, {
    status: HttpStatus.CREATED,
    description: 'Created product placement',
  })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'Invalid scope fields or unknown fish keys (40001)',
  )
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Product or spot does not exist (40401)')
  create(
    @Body() body: CreatePlacementDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.placements.create(body, admin, request);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a product placement' })
  @ApiParam(PLACEMENT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminPlacementItemDto, { description: 'Updated product placement' })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'Invalid scope fields or unknown fish keys (40001)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'Placement, product or spot does not exist (40401)',
  )
  update(
    @Param('id') id: string,
    @Body() body: UpdatePlacementDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.placements.update(id, body, admin, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a product placement' })
  @ApiParam(PLACEMENT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminPlacementDeleteDto, { description: 'Placement deleted' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Placement does not exist (40401)')
  remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.placements.delete(id, admin, request);
  }
}
