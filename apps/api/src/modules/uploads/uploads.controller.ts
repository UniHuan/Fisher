import {
  Body,
  Controller,
  HttpStatus,
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
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { UploadImageDto } from './dto/upload-image.dto';
import { UploadImageResponseDto } from './dto/upload-image-response.dto';
import type { UploadedImageFile } from './image-processor.service';
import { UploadsService } from './uploads.service';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const UPLOAD_BODY_SCHEMA = {
  type: 'object',
  required: ['spot_id', 'purpose', 'file'],
  properties: {
    spot_id: { type: 'string', example: '01HX0000000000000000000000' },
    purpose: { type: 'string', enum: ['cover', 'detail'] },
    file: { type: 'string', format: 'binary' },
  },
};

@ApiTags('admin uploads')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@ApiCommonErrorResponses([
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.INTERNAL,
])
@Controller('admin/uploads')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR)
@UseGuards(RolesGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @ApiOperation({ summary: 'Upload and compress a spot image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_BODY_SCHEMA })
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(UploadImageResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Compressed WebP image and short-lived preview URL',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot does not exist (40401)')
  @ApiErrorResponse(HttpStatus.PAYLOAD_TOO_LARGE, 'Image exceeds 10 MB (41301)')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'Storage unavailable (50301)')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  create(
    @Body() body: UploadImageDto,
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentAdmin() admin: AdminContext,
    @Req() request: RequestWithContext,
  ): Promise<UploadImageResponseDto> {
    return this.uploads.upload(body, file, admin, request);
  }
}
