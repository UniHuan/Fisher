import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import { sendConditionalJson } from '../../common/http/conditional-get';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
} from '../../common/openapi/api-response.decorators';
import type { RequestWithContext } from '../../common/types/request-context';
import { DictionariesService } from './dictionaries.service';
import { PublicDictionariesDto } from './dto/dictionary-response.dto';

@ApiTags('public')
@ApiClientHeaders()
@ApiCommonErrorResponses([ERROR_CODES.VALIDATION, ERROR_CODES.INTERNAL])
@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Get()
  @ApiEnvelopeResponse(PublicDictionariesDto, {
    description: 'Dictionary payload with a strong ETag',
  })
  @ApiResponse({ status: HttpStatus.NOT_MODIFIED, description: 'ETag matched; no body' })
  async list(
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ): Promise<void> {
    const payload = await this.dictionaries.getPublicDictionaries();
    sendConditionalJson(request, response, payload);
  }
}
