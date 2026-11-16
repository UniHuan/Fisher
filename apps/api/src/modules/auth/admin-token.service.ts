import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIN_ROLE, ERROR_CODES, type AdminRole } from '@szfisher/shared';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';

export const ADMIN_ACCESS_TTL_SECONDS = 30 * 60;
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const ADMIN_LAST_ACTIVE_TOUCH_MS = 60 * 1000;

const REFRESH_TOKEN_VERSION = 'v1';
const REFRESH_RANDOM_BYTES = 32;

export interface IssuedAccessToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export interface AccessTokenPayload {
  adminId: string;
  role: AdminRole;
  tokenVersion: number;
  jti: string;
}

export interface ParsedRefreshToken {
  adminId: string;
  token: string;
}

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === 'string' && (Object.values(ADMIN_ROLE) as string[]).includes(value)
  );
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AdminTokenService {
  private readonly accessSecret: string;
  private readonly refreshKey: Buffer;

  constructor(config: ConfigService) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    // Fixed domain separator keeps refresh HMACs distinct from access JWT signatures.
    this.refreshKey = Buffer.from(`${this.accessSecret}:refresh`, 'utf8');
  }

  issueAccess(admin: {
    admin_id: string;
    role: AdminRole;
    token_version: number;
  }): IssuedAccessToken {
    const jti = randomUUID();
    const token = jwt.sign(
      { role: admin.role, token_version: admin.token_version },
      this.accessSecret,
      {
        algorithm: 'HS256',
        subject: admin.admin_id,
        jwtid: jti,
        expiresIn: ADMIN_ACCESS_TTL_SECONDS,
      },
    );
    return {
      token,
      jti,
      expiresAt: new Date(Date.now() + ADMIN_ACCESS_TTL_SECONDS * 1000),
    };
  }

  verifyAccess(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS256'] });
      if (typeof decoded === 'string') {
        return null;
      }
      const { sub, role, token_version: tokenVersion, jti } = decoded;
      if (
        typeof sub !== 'string' ||
        !isAdminRole(role) ||
        typeof tokenVersion !== 'number' ||
        !Number.isInteger(tokenVersion) ||
        typeof jti !== 'string' ||
        jti.length === 0
      ) {
        return null;
      }
      return { adminId: sub, role, tokenVersion, jti };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppError(ERROR_CODES.TOKEN_EXPIRED, HttpStatus.UNAUTHORIZED, 'Token expired');
      }
      return null;
    }
  }

  issueRefresh(adminId: string): string {
    const random = randomBytes(REFRESH_RANDOM_BYTES).toString('base64url');
    const payload = `${REFRESH_TOKEN_VERSION}.${adminId}.${random}`;
    return `${payload}.${this.signRefresh(payload)}`;
  }

  parseRefresh(token: string): ParsedRefreshToken | null {
    const parts = token.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const [version, adminId, random, signature] = parts;
    if (
      version !== REFRESH_TOKEN_VERSION ||
      adminId === undefined ||
      adminId.length === 0 ||
      random === undefined ||
      random.length === 0 ||
      signature === undefined ||
      signature.length === 0
    ) {
      return null;
    }
    const payload = `${version}.${adminId}.${random}`;
    const expected = Buffer.from(this.signRefresh(payload), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (!safeEqual(expected, actual)) {
      return null;
    }
    return { adminId, token };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  refreshHashMatches(storedHash: string | null, token: string): boolean {
    if (storedHash === null || storedHash.length === 0) {
      return false;
    }
    const stored = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(this.hashRefresh(token), 'hex');
    return safeEqual(stored, actual);
  }

  private signRefresh(payload: string): string {
    return createHmac('sha256', this.refreshKey).update(payload, 'utf8').digest('base64url');
  }
}
