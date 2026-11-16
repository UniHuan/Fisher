import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import {
  type AdminDictionaryItem,
  type AdminDictionaryList,
} from './dictionary.constants';
import { DictionariesService } from './dictionaries.service';
import {
  AdminDictionaryItemDto,
  AdminDictionaryListDto,
} from './dto/dictionary-response.dto';
import { CreateDictionaryDto } from './dto/create-dictionary.dto';
import { UpdateDictionaryDto } from './dto/update-dictionary.dto';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

// PRD 8.7: dictionary maintenance is super-admin only.
@ApiTags('admin dictionaries')
@ApiCookieAuth('admin-cookie')
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/dictionaries')
@Roles(ADMIN_ROLE.SUPER_ADMIN)
@UseGuards(RolesGuard)
export class AdminDictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Get()
  @ApiOperation({ summary: 'List every dictionary row, including disabled ones' })
  @ApiEnvelopeResponse(AdminDictionaryListDto, {
    description: 'Dictionary rows in a stable list',
  })
  list(): Promise<AdminDictionaryList> {
    return this.dictionaries.listAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a dictionary row' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminDictionaryItemDto, {
    status: 201,
    description: 'Created dictionary row',
  })
  @ApiResponse({ status: 409, description: 'Dictionary key already exists (40901)' })
  create(
    @Body() body: CreateDictionaryDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminDictionaryItem> {
    return this.dictionaries.create(body, admin, request);
  }

  @Put(':type/:key')
  @ApiOperation({ summary: 'Update a dictionary label, order, visibility or parent' })
  @ApiParam({ name: 'type', example: 'poi_type' })
  @ApiParam({ name: 'key', example: 'food' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminDictionaryItemDto, { description: 'Updated dictionary row' })
  @ApiResponse({ status: 404, description: 'Dictionary row does not exist (40401)' })
  update(
    @Param('type') type: string,
    @Param('key') key: string,
    @Body() body: UpdateDictionaryDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<AdminDictionaryItem> {
    return this.dictionaries.update(type, key, body, admin, request);
  }
}
