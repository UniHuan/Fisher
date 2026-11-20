import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ContentSecurityMediaResult,
  ContentSecurityProvider,
  ContentSecurityTextInput,
  ContentSecurityTextResult,
  WechatMediaCallbackBody,
  WechatMediaCallbackQuery,
  WechatMediaEvent,
} from '../../src/modules/content-security/content-security.types';
import { ContentSecurityMediaError } from '../../src/modules/content-security/content-security.types';
import { verifyWechatMediaCallback } from '../../src/modules/content-security/wechat-media-crypto';

/**
 * Deterministic test double: content containing REVIEW needs human review,
 * content containing RISKY is rejected, THROW simulates a provider outage,
 * and everything else passes. Media checks return sequential trace ids; set
 * `failNextMediaCheck` to simulate an upstream submission failure once.
 * Callback verification uses the real safe-mode crypto so tampering tests are
 * exercised end to end.
 */
@Injectable()
export class FakeContentSecurityProvider implements ContentSecurityProvider {
  failNextMediaCheck = false;
  private mediaSequence = 0;

  constructor(private readonly config: ConfigService) {}

  async checkText(input: ContentSecurityTextInput): Promise<ContentSecurityTextResult> {
    if (input.content.includes('THROW')) {
      throw new Error('fake moderation outage');
    }
    if (input.content.includes('REVIEW')) {
      return { suggest: 'review', label: 20001, traceId: 'fake-review-trace' };
    }
    if (input.content.includes('RISKY')) {
      return { suggest: 'risky', label: 20002, traceId: 'fake-risky-trace' };
    }
    return { suggest: 'pass', label: 100, traceId: 'fake-pass-trace' };
  }

  async checkMedia(): Promise<ContentSecurityMediaResult> {
    if (this.failNextMediaCheck) {
      this.failNextMediaCheck = false;
      throw new ContentSecurityMediaError('fake-media-failure');
    }
    this.mediaSequence += 1;
    return { traceId: `fake-media-trace-${this.mediaSequence}` };
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
}
