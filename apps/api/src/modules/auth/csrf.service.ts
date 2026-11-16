import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('CSRF_SECRET');
  }

  /** base64url(HMAC-SHA256(CSRF_SECRET, admin_id + ":" + access_jti)) */
  generate(adminId: string, jti: string): string {
    return createHmac('sha256', this.secret)
      .update(`${adminId}:${jti}`, 'utf8')
      .digest('base64url');
  }

  verify(adminId: string, jti: string, token: string | undefined): boolean {
    if (token === undefined || token.length === 0) {
      return false;
    }
    const expected = Buffer.from(this.generate(adminId, jti), 'utf8');
    const actual = Buffer.from(token, 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
