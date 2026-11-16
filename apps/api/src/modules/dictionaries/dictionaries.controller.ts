import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ok } from '@szfisher/shared';
import type { Response } from 'express';
import type { RequestWithContext } from '../../common/types/request-context';
import { DictionariesService, etagMatches } from './dictionaries.service';
import type { PublicDictionaries } from './dictionary.constants';

@ApiTags('public')
@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @Get()
  @ApiOperation({ summary: 'Public dictionaries in seven stable groups' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Dictionary payload with a strong ETag' })
  @ApiResponse({ status: HttpStatus.NOT_MODIFIED, description: 'ETag matched; no body' })
  async list(
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ): Promise<void> {
    const { payload, etag } = await this.dictionaries.getPublicDictionaries();
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', DictionariesService.cacheControl());

    if (etagMatches(request.headers['if-none-match'], etag)) {
      response.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    response.status(HttpStatus.OK).json(ok<PublicDictionaries>(payload, request.requestId));
  }
}
