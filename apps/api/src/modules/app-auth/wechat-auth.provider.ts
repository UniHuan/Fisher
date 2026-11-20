/** Injection token so tests can swap the real WeChat exchange for a fake. */
export const WECHAT_AUTH_PROVIDER = Symbol('WECHAT_AUTH_PROVIDER');

/** Provider name stored in `user_identity.provider`. */
export const WECHAT_MINI_PROVIDER = 'wechat_mini';

export interface WechatIdentity {
  openid: string;
  unionid: string | null;
}

export interface WechatAuthProvider {
  /**
   * Exchanges a mini-program `wx.login` code for the caller's identity.
   * Implementations must discard the WeChat `session_key`.
   */
  exchangeCode(code: string): Promise<WechatIdentity>;
}
