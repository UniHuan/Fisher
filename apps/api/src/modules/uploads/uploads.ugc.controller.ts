import {
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import { CurrentAppUser } from '../../common/decorators/current-app-user.decorator';
import { AppAuthGuard } from '../../common/guards/app-auth.guard';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { AppUserContext } from '../../common/types/request-context';
import { UploadUgcResponseDto } from './dto/upload-ugc-response.dto';
import type { UploadedImageFile } from './image-processor.service';
import { UploadsUgcService } from './uploads.ugc.service';

const UGC_UPLOAD_BODY_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: { type: 'string', format: 'binary' },
  },
};

const UGC_UPLOAD_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.PAYLOAD_TOO_LARGE,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
  ERROR_CODES.INTERNAL,
] as const;

@ApiTags('uploads')
@ApiBearerAuth('bearer')
@ApiClientHeaders()
@Controller('uploads')
export class UploadsUgcController {
  constructor(private readonly uploads: UploadsUgcService) {}

  @Post('ugc')
  @UseGuards(AppAuthGuard)
  @ApiOperation({
    summary: 'Upload and compress a report image',
    description:
      'Accepts JPG, PNG and WebP up to 10 MB, re-encodes to WebP and returns the private work-bucket key. At most 30 images per user per day.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UGC_UPLOAD_BODY_SCHEMA })
  @ApiEnvelopeResponse(UploadUgcResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Compressed WebP work-bucket key and dimensions',
  })
  @ApiCommonErrorResponses(UGC_UPLOAD_ERROR_CODES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  create(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<UploadUgcResponseDto> {
    return this.uploads.upload(file, user);
  }
}
