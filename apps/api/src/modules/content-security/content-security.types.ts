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

/**
 * Text moderation boundary. Implementations must never publish on failure:
 * an unavailable upstream is reported as `review` so the content waits for a human.
 */
export interface ContentSecurityProvider {
  checkText(input: ContentSecurityTextInput): Promise<ContentSecurityTextResult>;
}
