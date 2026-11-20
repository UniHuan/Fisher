import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@szfisher/shared';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';

export const APP_ACCESS_TTL_SECONDS = 7200;
export const APP_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const REFRESH_TOKEN_VERSION = 'v1';
const REFRESH_RANDOM_BYTES = 32;

export interface IssuedAppAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AppAccessPayload {
  userId: string;
  tokenVersion: number;
  jti: string;
}

export interface ParsedAppRefreshToken {
  userId: string;
  token: string;
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AppTokenService {
  constructor(private readonly config: ConfigService) {}

  issueAccess(user: { user_id: string; token_version: number }): IssuedAppAccessToken {
    const jti = randomUUID();
    const token = jwt.sign({ token_version: user.token_version }, this.accessSecret, {
      algorithm: 'HS256',
      subject: user.user_id,
      jwtid: jti,
      expiresIn: APP_ACCESS_TTL_SECONDS,
    });
    return {
      token,
      expiresAt: new Date(Date.now() + APP_ACCESS_TTL_SECONDS * 1000),
    };
  }

  verifyAccess(token: string): AppAccessPayload | null {
    try {
      const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS256'] });
      if (typeof decoded === 'string') {
        return null;
      }
      const { sub, token_version: tokenVersion, jti } = decoded;
      if (
        typeof sub !== 'string' ||
        sub.length === 0 ||
        typeof tokenVersion !== 'number' ||
        !Number.isInteger(tokenVersion) ||
        typeof jti !== 'string' ||
        jti.length === 0
      ) {
        return null;
      }
      return { userId: sub, tokenVersion, jti };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppError(ERROR_CODES.TOKEN_EXPIRED, HttpStatus.UNAUTHORIZED, 'Token expired');
      }
      return null;
    }
  }

  issueRefresh(userId: string): string {
    const random = randomBytes(REFRESH_RANDOM_BYTES).toString('base64url');
    const payload = `${REFRESH_TOKEN_VERSION}.${userId}.${random}`;
    return `${payload}.${this.signRefresh(payload)}`;
  }

  parseRefresh(token: string): ParsedAppRefreshToken | null {
    const parts = token.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const [version, userId, random, signature] = parts;
    if (
      version !== REFRESH_TOKEN_VERSION ||
      userId === undefined ||
      userId.length === 0 ||
      random === undefined ||
      random.length === 0 ||
      signature === undefined ||
      signature.length === 0
    ) {
      return null;
    }
    const payload = `${version}.${userId}.${random}`;
    const expected = Buffer.from(this.signRefresh(payload), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (!safeEqual(expected, actual)) {
      return null;
    }
    return { userId, token };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private get accessSecret(): string {
    const secret = this.config.get<string>('APP_JWT_ACCESS_SECRET')?.trim() ?? '';
    if (secret.length === 0) {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'App authentication is not configured',
      );
    }
    return secret;
  }

  private signRefresh(payload: string): string {
    // Domain separation keeps refresh HMACs distinct from access JWT signatures.
    const key = Buffer.from(`${this.accessSecret}:refresh`, 'utf8');
    return createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
  }
}
