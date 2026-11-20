import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { recordMediaCheckResult } from '../reports/report-moderation.service';
import { StorageService } from '../storage/storage.service';
import { CONTENT_SECURITY_PROVIDER, type ContentSecurityProvider } from './content-security.types';
import {
  WechatMediaCallbackBodyDto,
  WechatMediaCallbackQueryDto,
} from './dto/wechat-media-callback.dto';

/**
 * Asynchronous `mediaCheckAsync` result callback. Shares
 * `/api/v1/wechat/media-check/callback` with the GET URL-verification handler;
 * the two controllers register different HTTP methods, never the same route.
 */
@ApiExcludeController()
@Controller('wechat/media-check')
export class WechatMediaCallbackController {
  constructor(
    @Inject(CONTENT_SECURITY_PROVIDER)
    private readonly contentSecurity: ContentSecurityProvider,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query() query: WechatMediaCallbackQueryDto,
    @Body() body: WechatMediaCallbackBodyDto,
    @Res() response: Response,
  ): Promise<void> {
    const verified = this.contentSecurity.verifyCallback(query, { Encrypt: body.Encrypt });
    if (!verified.valid || verified.event === undefined) {
      // Tampered signatures, ciphertext, appid or stale timestamps are all 400;
      // never echo which check failed.
      throw new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, 'Invalid callback');
    }

    // Unknown traces and duplicates are acknowledged with 200 so WeChat does not retry.
    await recordMediaCheckResult(this.prisma, this.storage, verified.event);

    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from('success', 'utf8'));
  }
}
