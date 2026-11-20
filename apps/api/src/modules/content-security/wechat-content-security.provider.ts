import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ContentSecurityMediaInput,
  ContentSecurityMediaResult,
  ContentSecurityProvider,
  ContentSecuritySuggest,
  ContentSecurityTextInput,
  ContentSecurityTextResult,
  WechatMediaCallbackBody,
  WechatMediaCallbackQuery,
  WechatMediaEvent,
} from './content-security.types';
import { ContentSecurityMediaError } from './content-security.types';
import {
  WechatAccessTokenError,
  WechatAccessTokenService,
} from './wechat-access-token.service';
import { verifyWechatMediaCallback } from './wechat-media-crypto';

const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const MEDIA_CHECK_URL = 'https://api.weixin.qq.com/wxa/media_check_async';
const MSG_SEC_CHECK_TIMEOUT_MS = 8000;
const MEDIA_CHECK_TIMEOUT_MS = 8000;
/** WeChat error codes that mean the access_token is missing, invalid or expired. */
const TOKEN_ERROR_CODES = new Set([40001, 40014, 42001]);
const SUGGEST_VALUES: readonly ContentSecuritySuggest[] = ['pass', 'review', 'risky'];

interface MsgSecCheckPayload {
  errcode?: unknown;
  errmsg?: unknown;
  trace_id?: unknown;
  result?: {
    suggest?: unknown;
    label?: unknown;
  };
}

interface MediaCheckPayload {
  errcode?: unknown;
  errmsg?: unknown;
  trace_id?: unknown;
}

/** Carries only a safe, loggable reason; never the content, openid or token. */
class WechatModerationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WechatModerationError';
  }
}

function isTokenError(payload: { errcode?: unknown }): boolean {
  return typeof payload.errcode === 'number' && TOKEN_ERROR_CODES.has(payload.errcode);
}

function normalizeSuggest(value: unknown): ContentSecuritySuggest {
  return SUGGEST_VALUES.includes(value as ContentSecuritySuggest)
    ? (value as ContentSecuritySuggest)
    : 'review';
}

/**
 * Real `security.msgSecCheck` v2 client. Every failure path resolves to
 * `review` so content waits for a human instead of being published unseen.
 */
@Injectable()
export class WechatContentSecurityProvider implements ContentSecurityProvider {
  private readonly logger = new Logger(WechatContentSecurityProvider.name);

  constructor(
    private readonly tokens: WechatAccessTokenService,
    private readonly config: ConfigService,
  ) {}

  async checkText(input: ContentSecurityTextInput): Promise<ContentSecurityTextResult> {
    try {
      let payload = await this.call(input);
      if (isTokenError(payload)) {
        this.tokens.invalidate();
        payload = await this.call(input);
      }
      return this.mapPayload(payload);
    } catch (error) {
      // Log only the safe reason; no content, openid, token or response body.
      const reason =
        error instanceof WechatModerationError || error instanceof WechatAccessTokenError
          ? error.reason
          : 'unexpected';
      this.logger.warn(`msgSecCheck failed (${reason}); routing content to human review`);
      return { suggest: 'review', errorCode: reason };
    }
  }

  async checkMedia(input: ContentSecurityMediaInput): Promise<ContentSecurityMediaResult> {
    try {
      let payload = await this.callMedia(input);
      if (isTokenError(payload)) {
        this.tokens.invalidate();
        payload = await this.callMedia(input);
      }
      if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
        throw new WechatModerationError(`errcode-${payload.errcode}`);
      }
      if (typeof payload.trace_id !== 'string' || payload.trace_id.length === 0) {
        throw new WechatModerationError('missing-trace-id');
      }
      return { traceId: payload.trace_id };
    } catch (error) {
      // Log only the safe reason; no image URL, openid, token or response body.
      const reason =
        error instanceof WechatModerationError || error instanceof WechatAccessTokenError
          ? error.reason
          : 'unexpected';
      this.logger.warn(`mediaCheckAsync failed (${reason}); routing content to human review`);
      throw new ContentSecurityMediaError(reason);
    }
  }

  verifyCallback(
    query: WechatMediaCallbackQuery,
    body: WechatMediaCallbackBody,
  ): { valid: boolean; event?: WechatMediaEvent } {
    return verifyWechatMediaCallback(
      {
        token: this.config.get<string>('WECHAT_MSG_TOKEN')?.trim() ?? '',
        encodingAesKey: this.config.get<string>('WECHAT_MSG_AES_KEY')?.trim() ?? '',
        appid: this.config.get<string>('WECHAT_MINI_APPID')?.trim() ?? '',
      },
      query,
      body,
    );
  }

  private async callMedia(input: ContentSecurityMediaInput): Promise<MediaCheckPayload> {
    const token = await this.tokens.getAccessToken();
    let response: Response;
    try {
      response = await fetch(
        `${MEDIA_CHECK_URL}?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_url: input.imageUrl,
            media_type: 2,
            version: 2,
            scene: 2,
            openid: input.openid,
          }),
          signal: AbortSignal.timeout(MEDIA_CHECK_TIMEOUT_MS),
        },
      );
    } catch {
      throw new WechatModerationError('request-failed');
    }
    if (!response.ok) {
      throw new WechatModerationError(`http-${response.status}`);
    }
    try {
      return (await response.json()) as MediaCheckPayload;
    } catch {
      throw new WechatModerationError('invalid-json');
    }
  }

  private async call(input: ContentSecurityTextInput): Promise<MsgSecCheckPayload> {
    const token = await this.tokens.getAccessToken();
    let response: Response;
    try {
      response = await fetch(
        `${MSG_SEC_CHECK_URL}?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: input.content,
            openid: input.openid,
            scene: 2,
            version: 2,
          }),
          signal: AbortSignal.timeout(MSG_SEC_CHECK_TIMEOUT_MS),
        },
      );
    } catch {
      throw new WechatModerationError('request-failed');
    }
    if (!response.ok) {
      throw new WechatModerationError(`http-${response.status}`);
    }
    try {
      return (await response.json()) as MsgSecCheckPayload;
    } catch {
      throw new WechatModerationError('invalid-json');
    }
  }

  private mapPayload(payload: MsgSecCheckPayload): ContentSecurityTextResult {
    if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
      throw new WechatModerationError(`errcode-${payload.errcode}`);
    }
    const result: ContentSecurityTextResult = {
      suggest: normalizeSuggest(payload.result?.suggest),
    };
    const label = payload.result?.label;
    if (typeof label === 'number' && Number.isFinite(label)) {
      result.label = label;
    }
    if (typeof payload.trace_id === 'string' && payload.trace_id.length > 0) {
      result.traceId = payload.trace_id;
    }
    return result;
  }
}
