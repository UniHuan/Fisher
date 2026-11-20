import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
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
} from '../../common/openapi/api-response.decorators';
import type { AdminContext } from '../../common/types/request-context';
import { AdminFeedbackService } from './admin-feedback.service';
import { AdminFeedbackListQueryDto } from './dto/admin-feedback-list-query.dto';
import {
  AdminFeedbackDetailDto,
  AdminFeedbackPageDto,
  AdminFeedbackUpdateResponseDto,
} from './dto/admin-feedback-response.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';

const CSRF_HEADER = {
  name: 'X-CSRF-Token',
  required: true,
  description: 'Synchronizer CSRF token issued by login or refresh',
};

const FEEDBACK_ID_PARAM = {
  name: 'id',
  description: 'Feedback ULID',
  example: '01HX0000000000000000000000',
};

const READ_ERROR_CODES = [
  ERROR_CODES.VALIDATION,
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.INTERNAL,
] as const;

const UPDATE_ERROR_CODES = READ_ERROR_CODES;

/**
 * Admin feedback queue. All three roles carry `feedback:read` and
 * `feedback:handle`; the class-level role check is the server authority.
 */
@ApiTags('admin feedback')
@ApiCookieAuth('admin-cookie')
@ApiClientHeaders()
@Controller('admin/feedback')
@Roles(ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER)
@UseGuards(RolesGuard)
export class AdminFeedbackController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get()
  @ApiOperation({
    summary: 'List trial feedback',
    description:
      'Newest first by created_at and feedback_id. status and category filter before pagination; default 20, maximum 50.',
  })
  @ApiEnvelopeResponse(AdminFeedbackPageDto, { description: 'Admin feedback page' })
  @ApiCommonErrorResponses(READ_ERROR_CODES)
  list(@Query() query: AdminFeedbackListQueryDto): Promise<AdminFeedbackPageDto> {
    return this.feedback.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one feedback with signed screenshot URLs',
    description:
      'Returns the full content, contact, page, spot name, user nickname, device context and 15-minute signed image URLs. Never returns an openid.',
  })
  @ApiParam(FEEDBACK_ID_PARAM)
  @ApiEnvelopeResponse(AdminFeedbackDetailDto, { description: 'One feedback detail' })
  @ApiCommonErrorResponses(READ_ERROR_CODES)
  detail(@Param('id') feedbackId: string): Promise<AdminFeedbackDetailDto> {
    return this.feedback.detail(feedbackId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update feedback status and handling note',
    description: 'Records the handling admin and time. The note is internal and never public.',
  })
  @ApiParam(FEEDBACK_ID_PARAM)
  @ApiHeader(CSRF_HEADER)
  @ApiEnvelopeResponse(AdminFeedbackUpdateResponseDto, { description: 'Feedback updated' })
  @ApiCommonErrorResponses(UPDATE_ERROR_CODES)
  update(
    @Param('id') feedbackId: string,
    @Body() body: UpdateFeedbackDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminFeedbackUpdateResponseDto> {
    return this.feedback.update(feedbackId, body, admin);
  }
}
