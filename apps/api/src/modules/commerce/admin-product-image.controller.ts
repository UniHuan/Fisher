import {
  Controller,
  HttpStatus,
  Param,
  Post,
  Req,
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
  ApiTags,
} from '@nestjs/swagger';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import type { UploadedImageFile } from '../uploads/image-processor.service';
import { ProductImageResponseDto } from './dto/product-image-response.dto';
import { ProductImageService } from './product-image.service';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const IMAGE_BODY_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: { type: 'string', format: 'binary' },
  },
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
export class AdminProductImageController {
  constructor(private readonly images: ProductImageService) {}

  @Post(':id/images')
  @ApiOperation({ summary: 'Upload and compress a product image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: IMAGE_BODY_SCHEMA })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(ProductImageResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Compressed WebP image and short-lived preview URL',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Product does not exist (40401)')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'Product is archived (40901)')
  @ApiErrorResponse(HttpStatus.PAYLOAD_TOO_LARGE, 'Image exceeds 10 MB (41301)')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'Storage unavailable (50301)')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  create(
    @Param('id') productId: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<ProductImageResponseDto> {
    return this.images.upload(productId, file, admin, request);
  }
}
