import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { StorageArea } from '../storage/storage.types';

/** Only server-generated image keys may be signed or read through the preview route. */
const PREVIEW_KEY_PATTERN =
  /^(spots|ugc|feedback|products)\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;

export interface PreviewSignature {
  url: string;
  expiresAt: string;
}

/**
 * Short-lived preview URLs for the private work/published buckets.
 *
 * The signature is HMAC-SHA256 over `preview|{area}|{key}|{expires}` using
 * `CSRF_SECRET` with a `preview:` domain separator, so a token signed for one
 * purpose (CSRF, storage preview) cannot be replayed here. The route serves the
 * bytes itself, keeping OSS credentials and bucket names out of the browser.
 */
@Injectable()
export class PreviewSignerService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = `${config.getOrThrow<string>('CSRF_SECRET')}:preview`;
  }

  sign(key: string, area: StorageArea, ttlSeconds: number): PreviewSignature {
    if (!PREVIEW_KEY_PATTERN.test(key)) {
      throw new Error('Invalid preview key');
    }
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
    const query = new URLSearchParams({
      key,
      area,
      expires: String(expires),
      signature: this.hmac(key, area, expires),
    });
    return {
      url: `/api/v1/uploads/preview?${query.toString()}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  verify(key: string, area: StorageArea, expires: number, signature: string): boolean {
    if (!PREVIEW_KEY_PATTERN.test(key) || !Number.isInteger(expires)) {
      return false;
    }
    if (area !== 'working' && area !== 'published') {
      return false;
    }
    if (expires < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = Buffer.from(this.hmac(key, area, expires));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private hmac(key: string, area: StorageArea, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`preview|${area}|${key}|${expires}`)
      .digest('base64url');
  }
}
