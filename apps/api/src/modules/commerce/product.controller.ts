import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import { ProductCardListDto } from './dto/product-card.dto';
import { ProductService } from './product.service';

@ApiTags('public products')
@ApiClientHeaders()
@ApiCommonErrorResponses([ERROR_CODES.VALIDATION, ERROR_CODES.INTERNAL])
@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'List public product cards for a surface' })
  @ApiEnvelopeResponse(ProductCardListDto, { description: 'Product cards in placement order' })
  list(@Query() query: PublicProductQueryDto) {
    return this.products.listPublic(query);
  }
}
