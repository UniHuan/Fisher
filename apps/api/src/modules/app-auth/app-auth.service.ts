import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODERATION_STATUS, ERROR_CODES } from '@szfisher/shared';
import { Prisma, type AppUser } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext, RequestWithContext } from '../../common/types/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { RateLimitRule } from '../rate-limit/rate-limit.types';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { APP_ACCESS_TTL_SECONDS, APP_REFRESH_TTL_MS, AppTokenService } from './app-token.service';
import { maskClientIp } from './client-ip';
import {
  WECHAT_AUTH_PROVIDER,
  WECHAT_MINI_PROVIDER,
  type WechatAuthProvider,
  type WechatIdentity,
} from './wechat-auth.provider';

const LOGIN_IP_RULE: RateLimitRule = { limit: 20, windowSeconds: 60 };
const LOGIN_OPENID_RULE: RateLimitRule = { limit: 10, windowSeconds: 60 };
const NOTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const NOTICE_LIMIT = 3;
const AUTHOR_DELETED_REASON = 'author_deleted';
const NOTICE_STATUSES = [
  MODERATION_STATUS.MACHINE_REJECTED,
  MODERATION_STATUS.HUMAN_REJECTED,
  MODERATION_STATUS.REMOVED,
];

export interface AppSessionUser {
  nickname: string | null;
  avatar_url: string | null;
}

export interface AppSessionResult {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: AppSessionUser;
}

export interface AppNotice {
  report_id: string;
  moderation_status: string;
  reject_reason: string | null;
  audit_time: Date;
}

export interface AppMeResult {
  user: AppSessionUser;
  can_publish: boolean;
  restricted_until: Date | null;
  notices: AppNotice[];
}

interface ResolvedUser {
  user: AppUser;
  identityId: string;
}

interface NoticeRow {
  report_id: string;
  moderation_status: string;
  reject_reason: string | null;
  notice_time: Date;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AppAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokens: AppTokenService,
    private readonly rateLimit: RateLimitService,
    @Inject(WECHAT_AUTH_PROVIDER) private readonly wechat: WechatAuthProvider,
  ) {}

  async login(code: string, request: RequestWithContext): Promise<AppSessionResult> {
    this.assertConfigured();
    const now = new Date();
    const ip = request.ip ?? '';

    // Per-IP first so credential floods never reach the WeChat exchange, then
    // per-openid once the caller is known. Counters store only SHA-256 digests.
    await this.hitLimit(`app-login:ip:${sha256Hex(ip)}`, LOGIN_IP_RULE);
    const identity = await this.wechat.exchangeCode(code);
    await this.hitLimit(`app-login:openid:${sha256Hex(identity.openid)}`, LOGIN_OPENID_RULE);

    const resolved = await this.findOrCreateUser(identity);
    const user = resolved.user;
    if (user.status !== 'active' || user.deleted_at !== null) {
      throw this.forbidden('Account is not available');
    }

    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { user_id: user.user_id },
        data: { last_login_at: now },
      }),
      this.prisma.userIdentity.update({
        where: { identity_id: resolved.identityId },
        data: { last_login_at: now, unionid: identity.unionid ?? undefined },
      }),
    ]);

    const refreshToken = this.tokens.issueRefresh(user.user_id);
    await this.prisma.userSession.create({
      data: {
        session_id: ulid(),
        user_id: user.user_id,
        refresh_token_hash: this.tokens.hashRefresh(refreshToken),
        ip: maskClientIp(ip),
        user_agent: this.readUserAgent(request),
        expires_at: new Date(now.getTime() + APP_REFRESH_TTL_MS),
      },
    });

    return this.sessionResult(user, refreshToken);
  }

  async refresh(refreshToken: string, request: RequestWithContext): Promise<AppSessionResult> {
    const parsed = this.tokens.parseRefresh(refreshToken);
    if (parsed === null) {
      throw this.unauthenticated('Invalid refresh token');
    }
    const session = await this.prisma.userSession.findUnique({
      where: { refresh_token_hash: this.tokens.hashRefresh(refreshToken) },
      include: { user: true },
    });
    if (session === null || session.user_id !== parsed.userId) {
      throw this.unauthenticated('Invalid refresh token');
    }

    const now = new Date();
    const user = session.user;
    if (user.status !== 'active' || user.deleted_at !== null) {
      throw this.forbidden('Account is not available');
    }
    if (session.revoked_at !== null) {
      // A rotated-away or logged-out token came back: assume theft.
      await this.revokeAllSessions(user.user_id, now);
      throw this.unauthenticated('Invalid refresh token');
    }
    if (session.expires_at.getTime() <= now.getTime()) {
      throw this.unauthenticated('Invalid refresh token');
    }

    const nextRefreshToken = this.tokens.issueRefresh(user.user_id);
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional revoke closes the race between two concurrent refreshes.
      const revoked = await tx.userSession.updateMany({
        where: { session_id: session.session_id, revoked_at: null },
        data: { revoked_at: now, last_used_at: now },
      });
      if (revoked.count === 0) {
        return false;
      }
      await tx.userSession.create({
        data: {
          session_id: ulid(),
          user_id: user.user_id,
          refresh_token_hash: this.tokens.hashRefresh(nextRefreshToken),
          rotated_from: session.session_id,
          ip: maskClientIp(request.ip),
          user_agent: this.readUserAgent(request),
          expires_at: new Date(now.getTime() + APP_REFRESH_TTL_MS),
        },
      });
      return true;
    });
    if (!rotated) {
      await this.revokeAllSessions(user.user_id, now);
      throw this.unauthenticated('Invalid refresh token');
    }

    return this.sessionResult(user, nextRefreshToken);
  }

  async logout(refreshToken: string, appUser: AppUserContext): Promise<void> {
    const parsed = this.tokens.parseRefresh(refreshToken);
    if (parsed === null) {
      throw this.unauthenticated('Invalid refresh token');
    }
    if (parsed.userId !== appUser.userId) {
      throw this.forbidden('Refresh token does not belong to this user');
    }
    const now = new Date();
    await this.prisma.userSession.updateMany({
      where: {
        user_id: appUser.userId,
        refresh_token_hash: this.tokens.hashRefresh(refreshToken),
        revoked_at: null,
      },
      data: { revoked_at: now, last_used_at: now },
    });
  }

  async getMe(appUser: AppUserContext): Promise<AppMeResult> {
    const user = await this.prisma.appUser.findUnique({
      where: { user_id: appUser.userId },
    });
    if (user === null) {
      throw this.unauthenticated();
    }
    const now = new Date();
    const cutoff = new Date(now.getTime() - NOTICE_WINDOW_MS);
    // "Latest 3" must rank by audit_time ?? created_at; machine rejections have
    // audit_time = NULL, so ordering by audit_time alone would bury them.
    const rows = await this.prisma.$queryRaw<NoticeRow[]>`
      SELECT report_id,
             moderation_status,
             reject_reason,
             COALESCE(audit_time, created_at) AS notice_time
      FROM report
      WHERE user_id = ${user.user_id}
        AND moderation_status IN (${Prisma.join(NOTICE_STATUSES)})
        AND COALESCE(audit_time, created_at) >= ${cutoff}
        AND (reject_reason IS NULL OR reject_reason <> ${AUTHOR_DELETED_REASON})
      ORDER BY COALESCE(audit_time, created_at) DESC
      LIMIT ${NOTICE_LIMIT}
    `;

    return {
      user: { nickname: user.nickname, avatar_url: user.avatar_url },
      can_publish:
        user.status === 'active' &&
        user.deleted_at === null &&
        (user.restricted_until === null || user.restricted_until.getTime() <= now.getTime()),
      restricted_until: user.restricted_until,
      notices: rows.map((row) => ({
        report_id: row.report_id,
        moderation_status: row.moderation_status,
        reject_reason: row.reject_reason,
        audit_time: row.notice_time,
      })),
    };
  }

  /** Verifies a bearer access token and loads the live user behind it. */
  async authenticateAccess(accessToken: string): Promise<AppUserContext> {
    const payload = this.tokens.verifyAccess(accessToken);
    if (payload === null) {
      throw this.unauthenticated();
    }
    const user = await this.prisma.appUser.findUnique({
      where: { user_id: payload.userId },
      include: {
        user_identities: {
          where: { provider: WECHAT_MINI_PROVIDER },
          orderBy: { is_primary: 'desc' },
          take: 1,
        },
      },
    });
    if (
      user === null ||
      user.status !== 'active' ||
      user.deleted_at !== null ||
      user.token_version !== payload.tokenVersion
    ) {
      throw this.unauthenticated();
    }
    const identity = user.user_identities[0];
    if (identity === undefined) {
      throw this.unauthenticated();
    }
    return {
      userId: user.user_id,
      openid: identity.provider_uid,
      nickname: user.nickname,
      status: user.status,
      tokenVersion: user.token_version,
    };
  }

  private async findOrCreateUser(identity: WechatIdentity): Promise<ResolvedUser> {
    const existing = await this.findIdentity(identity.openid);
    if (existing !== null) {
      return existing;
    }

    const userId = ulid();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.appUser.create({
          data: { user_id: userId, nickname: `钓友 ${userId.slice(-4)}` },
        });
        const created = await tx.userIdentity.create({
          data: {
            identity_id: ulid(),
            user_id: userId,
            provider: WECHAT_MINI_PROVIDER,
            provider_uid: identity.openid,
            unionid: identity.unionid,
            is_primary: true,
          },
        });
        return { user, identityId: created.identity_id };
      });
    } catch (error) {
      // Concurrent first login: the unique (provider, provider_uid) constraint
      // decides; the loser re-reads the winner's identity.
      if (isUniqueConstraintError(error)) {
        const winner = await this.findIdentity(identity.openid);
        if (winner !== null) {
          return winner;
        }
      }
      throw error;
    }
  }

  private findIdentity(openid: string): Promise<ResolvedUser | null> {
    return this.prisma.userIdentity
      .findUnique({
        where: {
          provider_provider_uid: { provider: WECHAT_MINI_PROVIDER, provider_uid: openid },
        },
        include: { user: true },
      })
      .then((row) => (row === null ? null : { user: row.user, identityId: row.identity_id }));
  }

  private async hitLimit(key: string, rule: RateLimitRule): Promise<void> {
    const decision = await this.rateLimit.hit(key, rule);
    if (!decision.allowed) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many login attempts',
      );
    }
  }

  private async revokeAllSessions(userId: string, now: Date): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: now },
    });
  }

  private sessionResult(user: AppUser, refreshToken: string): AppSessionResult {
    const access = this.tokens.issueAccess(user);
    return {
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: APP_ACCESS_TTL_SECONDS,
      user: { nickname: user.nickname, avatar_url: user.avatar_url },
    };
  }

  private readUserAgent(request: RequestWithContext): string | null {
    const header = request.headers['user-agent'];
    if (typeof header !== 'string' || header.length === 0) {
      return null;
    }
    return header.slice(0, 255);
  }

  private assertConfigured(): void {
    for (const key of ['WECHAT_MINI_APPID', 'WECHAT_MINI_SECRET', 'APP_JWT_ACCESS_SECRET']) {
      const value = this.config.get<string>(key)?.trim() ?? '';
      if (value.length === 0) {
        throw new AppError(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          'App authentication is not configured',
        );
      }
    }
  }

  private unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, message);
  }

  private forbidden(message: string): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, message);
  }
}
