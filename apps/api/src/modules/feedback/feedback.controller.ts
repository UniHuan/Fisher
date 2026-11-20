import {
  Body,
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
import type { UploadedImageFile } from '../uploads/image-processor.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import {
  CreateFeedbackResponseDto,
  UploadFeedbackImageResponseDto,
} from './dto/feedback-response.dto';
import { FeedbackImageService, MAX_FEEDBACK_IMAGE_BYTES } from './feedback-image.service';
import { FeedbackService } from './feedback.service';

const UPLOAD_BODY_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: { type: 'string', format: 'binary' },
  },
};

const UPLOAD_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.PAYLOAD_TOO_LARGE,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
  ERROR_CODES.INTERNAL,
] as const;

const CREATE_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FEATURE_DISABLED,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.INTERNAL,
] as const;

@ApiTags('feedback')
@ApiClientHeaders()
@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly images: FeedbackImageService,
  ) {}

  @Post('images')
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Upload and compress a feedback screenshot',
    description:
      'Accepts JPG, PNG and WebP up to 5 MB, re-encodes to WebP and returns the private work-bucket key. At most 10 images per user per day.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_BODY_SCHEMA })
  @ApiEnvelopeResponse(UploadFeedbackImageResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Compressed WebP work-bucket key and dimensions',
  })
  @ApiCommonErrorResponses(UPLOAD_ERROR_CODES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FEEDBACK_IMAGE_BYTES, files: 1 },
    }),
  )
  uploadImage(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<UploadFeedbackImageResponseDto> {
    return this.images.upload(file, user);
  }

  @Post()
  @UseGuards(AppAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Submit trial feedback',
    description:
      'Stores 10 to 500 characters plus optional page, spot, version, device context and up to 3 owned pending images. At most 5 feedbacks per user per day.',
  })
  @ApiEnvelopeResponse(CreateFeedbackResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Feedback stored as open',
  })
  @ApiCommonErrorResponses(CREATE_ERROR_CODES)
  create(
    @Body() body: CreateFeedbackDto,
    @CurrentAppUser() user: AppUserContext | undefined,
  ): Promise<CreateFeedbackResponseDto> {
    return this.feedback.create(body, user);
  }
}
