import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import type { WechatAuthProvider, WechatIdentity } from './wechat-auth.provider';

const JSCODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const REQUEST_TIMEOUT_MS = 5000;
// Invalid or already-used login codes: the client must call wx.login again.
const INVALID_CODE_ERRCODES = new Set([40029, 40163]);

interface JsCodeSessionPayload {
  openid?: unknown;
  unionid?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

@Injectable()
export class WechatMiniAuthProvider implements WechatAuthProvider {
  private readonly logger = new Logger(WechatMiniAuthProvider.name);

  constructor(private readonly config: ConfigService) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    const appid = this.config.get<string>('WECHAT_MINI_APPID')?.trim() ?? '';
    const secret = this.config.get<string>('WECHAT_MINI_SECRET')?.trim() ?? '';
    if (appid.length === 0 || secret.length === 0) {
      throw this.dependencyUnavailable();
    }

    const url = new URL(JSCODE2SESSION_URL);
    url.searchParams.set('appid', appid);
    url.searchParams.set('secret', secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    let payload: JsCodeSessionPayload;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn(`jscode2session http_status=${response.status}`);
        throw this.dependencyUnavailable();
      }
      payload = (await response.json()) as JsCodeSessionPayload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`jscode2session request_failed=${reason}`);
      throw this.dependencyUnavailable();
    }

    const errcode = typeof payload.errcode === 'number' ? payload.errcode : 0;
    if (errcode !== 0) {
      // errmsg is intentionally not surfaced or logged.
      this.logger.warn(`jscode2session errcode=${errcode}`);
      if (INVALID_CODE_ERRCODES.has(errcode)) {
        throw new AppError(
          ERROR_CODES.UNAUTHENTICATED,
          HttpStatus.UNAUTHORIZED,
          'WeChat login failed',
        );
      }
      throw this.dependencyUnavailable();
    }

    // `session_key` is deliberately never read: it must not leave this method.
    // Length bounds match user_identity.provider_uid/unionid column widths.
    if (
      typeof payload.openid !== 'string' ||
      payload.openid.length === 0 ||
      payload.openid.length > 128
    ) {
      this.logger.warn('jscode2session missing_openid');
      throw this.dependencyUnavailable();
    }
    return {
      openid: payload.openid,
      unionid:
        typeof payload.unionid === 'string' &&
        payload.unionid.length > 0 &&
        payload.unionid.length <= 64
          ? payload.unionid
          : null,
    };
  }

  private dependencyUnavailable(): AppError {
    return new AppError(
      ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      'WeChat login is temporarily unavailable',
    );
  }
}
