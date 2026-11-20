import { Injectable, Logger } from '@nestjs/common';
import type {
  ContentSecurityProvider,
  ContentSecuritySuggest,
  ContentSecurityTextInput,
  ContentSecurityTextResult,
} from './content-security.types';
import { WechatAccessTokenService } from './wechat-access-token.service';

const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const MSG_SEC_CHECK_TIMEOUT_MS = 8000;
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

/** Carries only a safe, loggable reason; never the content, openid or token. */
class WechatModerationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WechatModerationError';
  }
}

function isTokenError(payload: MsgSecCheckPayload): boolean {
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

  constructor(private readonly tokens: WechatAccessTokenService) {}

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
      const reason = error instanceof WechatModerationError ? error.reason : 'unexpected';
      this.logger.warn(`msgSecCheck failed (${reason}); routing content to human review`);
      return { suggest: 'review' };
    }
  }

  private async call(input: ContentSecurityTextInput): Promise<MsgSecCheckPayload> {
    const token = await this.tokens.getAccessToken();
    const response = await fetch(`${MSG_SEC_CHECK_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        openid: input.openid,
        scene: 2,
        version: 2,
      }),
      signal: AbortSignal.timeout(MSG_SEC_CHECK_TIMEOUT_MS),
    });
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
