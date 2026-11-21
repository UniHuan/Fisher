import {
  Body,
  Controller,
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
  AdminProductDetailDto,
  AdminProductListQueryDto,
  AdminProductPageDto,
} from './dto/admin-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const PRODUCT_ID_PARAM = {
  name: 'id',
  description: 'Product ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('admin products')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/products')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
export class AdminProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List products for admin management' })
  @ApiEnvelopeResponse(AdminProductPageDto, { description: 'Paginated admin product rows' })
  list(@Query() query: AdminProductListQueryDto) {
    return this.products.listAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one product with channels and image urls' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiEnvelopeResponse(AdminProductDetailDto, { description: 'Admin product detail' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Product does not exist (40401)')
  detail(@Param('id') id: string) {
    return this.products.getAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft product with its channel' })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminProductDetailDto, {
    status: HttpStatus.CREATED,
    description: 'Created draft product and channel',
  })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'Invalid product, channel or purchase action (40001)',
  )
  create(
    @Body() body: CreateProductDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.products.create(body, admin, request);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a product and replace its channel set' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminProductDetailDto, { description: 'Updated product detail' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Product does not exist (40401)')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'Image publishing unavailable (50301)')
  update(
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.products.update(id, body, admin, request);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a product' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminProductDetailDto, { description: 'Archived product detail' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Product does not exist (40401)')
  archive(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ) {
    return this.products.archive(id, admin, request);
  }
}
