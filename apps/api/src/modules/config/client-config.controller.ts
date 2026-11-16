import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { sendConditionalJson } from '../../common/http/conditional-get';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { RequestWithContext } from '../../common/types/request-context';
import { ClientConfigService } from './config.service';
import { ClientConfigDto } from './dto/client-config.dto';

@ApiTags('config')
@ApiCommonErrorResponses([ERROR_CODES.VALIDATION, ERROR_CODES.INTERNAL])
@Controller('config')
export class ClientConfigController {
  constructor(private readonly config: ClientConfigService) {}

  @Get()
  @ApiEnvelopeResponse(ClientConfigDto, {
    description: 'Map defaults, feature switches and freshness with a strong ETag',
  })
  @ApiResponse({ status: HttpStatus.NOT_MODIFIED, description: 'ETag matched; no body' })
  async get(
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ): Promise<void> {
    const payload = await this.config.getClientConfig();
    sendConditionalJson(request, response, payload);
  }
}
