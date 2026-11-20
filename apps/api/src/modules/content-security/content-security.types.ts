/** Injection token for the content security provider (real WeChat client or test double). */
export const CONTENT_SECURITY_PROVIDER = Symbol('CONTENT_SECURITY_PROVIDER');

export type ContentSecuritySuggest = 'pass' | 'review' | 'risky';

export interface ContentSecurityTextInput {
  content: string;
  openid: string;
}

export interface ContentSecurityTextResult {
  suggest: ContentSecuritySuggest;
  label?: number;
  traceId?: string;
  /** Safe failure reason (for example `errcode-40001`), never content or openid. */
  errorCode?: string;
}

export interface ContentSecurityMediaInput {
  /** Short-lived work-bucket URL that WeChat can fetch. */
  imageUrl: string;
  openid: string;
}

export interface ContentSecurityMediaResult {
  /** Provider trace id used to match the asynchronous `wxa_media_check` callback. */
  traceId: string;
}

/** Safe, loggable media failure reason; never the image URL, openid or response body. */
export class ContentSecurityMediaError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ContentSecurityMediaError';
  }
}

/** Normalized `wxa_media_check` callback event. */
export interface WechatMediaEvent {
  traceId: string;
  suggest: ContentSecuritySuggest;
  label?: number;
  /** Set when WeChat reported an error instead of a usable suggestion. */
  errorCode?: string;
}

export interface WechatMediaCallbackQuery {
  signature: string;
  timestamp: string;
  nonce: string;
  msg_signature: string;
}

export interface WechatMediaCallbackBody {
  Encrypt: string;
}

/**
 * Content security boundary. Implementations must never publish on failure:
 * an unavailable upstream is reported as `review` so the content waits for a human.
 */
export interface ContentSecurityProvider {
  checkText(input: ContentSecurityTextInput): Promise<ContentSecurityTextResult>;
  checkMedia(input: ContentSecurityMediaInput): Promise<ContentSecurityMediaResult>;
  verifyCallback(
    query: WechatMediaCallbackQuery,
    body: WechatMediaCallbackBody,
  ): { valid: boolean; event?: WechatMediaEvent };
}
