import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateSecret as otpGenerateSecret,
  generateURI as otpGenerateUri,
  verifySync as otpVerifySync,
} from 'otplib';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ISSUER = '深圳钓鱼助手';
const SECRET_VERSION = 'v1';
const GCM_IV_BYTES = 12;
const TOTP_TOLERANCE_SECONDS = 30;

@Injectable()
export class TotpService {
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    const configuredKey = config.getOrThrow<string>('TOTP_ENCRYPTION_KEY');
    // AES-256-GCM needs exactly 32 bytes regardless of the configured passphrase length.
    this.encryptionKey = createHash('sha256').update(configuredKey, 'utf8').digest();
  }

  generateSecret(): string {
    return otpGenerateSecret();
  }

  buildUri(username: string, secret: string): string {
    return otpGenerateUri({ issuer: ISSUER, label: username, secret });
  }

  verify(secret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) {
      return false;
    }
    try {
      return otpVerifySync({ secret, token: code, epochTolerance: TOTP_TOLERANCE_SECONDS }).valid;
    } catch {
      return false;
    }
  }

  /** Stores `v1.<iv>.<ciphertext>.<tag>` with base64url segments. */
  encryptSecret(secret: string): string {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      SECRET_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  decryptSecret(value: string): string | null {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== SECRET_VERSION) {
      return null;
    }
    const [, ivPart, ciphertextPart, tagPart] = parts;
    if (!ivPart || !ciphertextPart || !tagPart) {
      return null;
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(ivPart, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      return null;
    }
  }
}
