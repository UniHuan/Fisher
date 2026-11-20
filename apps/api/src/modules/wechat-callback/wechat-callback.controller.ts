import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import type { Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { WechatVerifyQueryDto } from './dto/wechat-verify-query.dto';
import { verifyWechatSignature } from './wechat-signature';

const MAX_CLOCK_SKEW_SECONDS = 10 * 60;

@ApiExcludeController()
@Controller('wechat/media-check')
export class WechatMediaCheckCallbackController {
  constructor(private readonly config: ConfigService) {}

  @Get('callback')
  verify(@Query() query: WechatVerifyQueryDto, @Res() response: Response): void {
    const { signature, timestamp, nonce, echostr } = query;
    const token = this.config.get<string>('WECHAT_MSG_TOKEN') ?? '';
    if (token.length === 0) {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'WeChat message push is not configured',
      );
    }
    if (!verifyWechatSignature(token, timestamp, nonce, signature)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, 'Invalid signature');
    }

    const timestampSeconds = Number(timestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
    ) {
      throw new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, 'Stale signature');
    }

    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(echostr);
  }
}
