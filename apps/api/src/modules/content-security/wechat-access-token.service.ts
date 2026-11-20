import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const TOKEN_TIMEOUT_MS = 5000;
/** Refresh five minutes before WeChat's stated expiry to avoid using a stale token. */
const TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRES_IN_SECONDS = 7200;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface TokenPayload {
  access_token?: unknown;
  expires_in?: unknown;
  errcode?: unknown;
}

/** Carries only a safe, loggable reason; never the appid, secret or token. */
export class WechatAccessTokenError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WechatAccessTokenError';
  }
}

/** Caches the mini-program access_token in memory, shared by all moderation calls. */
@Injectable()
export class WechatAccessTokenService {
  private cached: CachedToken | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.cached !== null && this.cached.expiresAt > Date.now()) {
      return this.cached.token;
    }
    if (this.pending === null) {
      this.pending = this.fetchToken().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** Drops the cached token so the next call refreshes it (used after token errors). */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchToken(): Promise<string> {
    const appid = this.config.get<string>('WECHAT_MINI_APPID')?.trim() ?? '';
    const secret = this.config.get<string>('WECHAT_MINI_SECRET')?.trim() ?? '';
    if (appid === '' || secret === '') {
      throw new WechatAccessTokenError('token-not-configured');
    }

    const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(
      appid,
    )}&secret=${encodeURIComponent(secret)}`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
    } catch {
      throw new WechatAccessTokenError('token-request-failed');
    }
    if (!response.ok) {
      throw new WechatAccessTokenError(`token-http-${response.status}`);
    }

    let payload: TokenPayload;
    try {
      payload = (await response.json()) as TokenPayload;
    } catch {
      throw new WechatAccessTokenError('token-invalid-json');
    }
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      // Only the numeric errcode is safe to surface; never log the request URL.
      throw new WechatAccessTokenError(
        typeof payload.errcode === 'number'
          ? `token-errcode-${payload.errcode}`
          : 'token-missing',
      );
    }

    const expiresIn =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? payload.expires_in
        : DEFAULT_EXPIRES_IN_SECONDS;
    const ttlMs = Math.max(60, expiresIn * 1000 - TOKEN_EARLY_REFRESH_MS);
    this.cached = { token: payload.access_token, expiresAt: Date.now() + ttlMs };
    return payload.access_token;
  }
}
