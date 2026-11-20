import { Injectable } from '@nestjs/common';
import type {
  ContentSecurityProvider,
  ContentSecurityTextInput,
  ContentSecurityTextResult,
} from '../../src/modules/content-security/content-security.types';

/**
 * Deterministic test double: content containing REVIEW needs human review,
 * content containing RISKY is rejected, everything else passes.
 */
@Injectable()
export class FakeContentSecurityProvider implements ContentSecurityProvider {
  async checkText(input: ContentSecurityTextInput): Promise<ContentSecurityTextResult> {
    if (input.content.includes('REVIEW')) {
      return { suggest: 'review', label: 20001, traceId: 'fake-review-trace' };
    }
    if (input.content.includes('RISKY')) {
      return { suggest: 'risky', label: 20002, traceId: 'fake-risky-trace' };
    }
    return { suggest: 'pass', label: 100, traceId: 'fake-pass-trace' };
  }
}
