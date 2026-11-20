import { Injectable } from '@nestjs/common';
import type {
  WechatAuthProvider,
  WechatIdentity,
} from '../../src/modules/app-auth/wechat-auth.provider';

/**
 * Deterministic test double: the login code is treated as the openid, so tests
 * can address a stable identity without reaching api.weixin.qq.com.
 */
@Injectable()
export class FakeWechatAuthProvider implements WechatAuthProvider {
  async exchangeCode(code: string): Promise<WechatIdentity> {
    return { openid: code, unionid: null };
  }
}
