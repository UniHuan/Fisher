import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminUser, IdempotencyKey } from '@prisma/client';
import { ADMIN_ROLE, ERROR_CODES, type AdminRole } from '@szfisher/shared';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AdminUsersRepository } from '../admin/admin-users.repository';
import {
  ADMIN_SESSION_ABSOLUTE_MS,
  ADMIN_SESSION_IDLE_MS,
  AdminTokenService,
  isAdminRole,
} from './admin-token.service';
import { CsrfService } from './csrf.service';
import type { LoginDto } from './dto/login.dto';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';

const MFA_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_MFA_ATTEMPTS = 5;
const GENERIC_LOGIN_MESSAGE = 'Invalid username or password';
const INVALID_MFA_MESSAGE = 'Invalid or expired MFA token';
const INVALID_REFRESH_MESSAGE = 'Invalid refresh token';

export interface AdminProfile {
  admin_id: string;
  username: string;
  role: AdminRole;
  totp_enabled: boolean;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  csrf_token: string;
  admin: AdminProfile;
}

export interface MfaRequiredBody {
  mfa_required: true;
  mfa_token: string;
}

export interface MustBindTotpBody {
  must_bind_totp: true;
  mfa_token: string;
}

export type LoginResult =
  | { kind: 'session'; session: IssuedSession }
  | { kind: 'mfa_required'; body: MfaRequiredBody }
  | { kind: 'must_bind_totp'; body: MustBindTotpBody };

export interface TotpSetupResult {
  otpauth_uri: string;
  manual_key: string;
}

export interface TotpEnableResult {
  session: IssuedSession;
  recovery_codes: string[];
}

export interface RecoveryLoginResult {
  session: IssuedSession;
  remaining_recovery_codes: number;
}

export interface MeResult {
  admin: AdminProfile;
  permissions: string[];
  csrf_token: string;
}

interface RequestMeta {
  ip: string;
  userAgent: string;
  requestId: string;
}

function readRequestMeta(request: RequestWithContext): RequestMeta {
  const userAgentHeader = request.headers['user-agent'];
  return {
    ip: request.ip ?? '',
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : '',
    requestId: request.requestId ?? '',
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** sha256(ip + "|" + user_agent), binding MFA challenges to the login client. */
function requestDigest(meta: RequestMeta): string {
  return sha256Hex(`${meta.ip}|${meta.userAgent}`);
}

function readMfaAttempts(responseJson: unknown): number {
  if (typeof responseJson !== 'object' || responseJson === null || Array.isArray(responseJson)) {
    return 0;
  }
  const attempts = (responseJson as { attempts?: unknown }).attempts;
  return typeof attempts === 'number' && Number.isInteger(attempts) && attempts >= 0
    ? attempts
    : 0;
}

function toAdminProfile(admin: AdminUser): AdminProfile {
  if (!isAdminRole(admin.role)) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Admin account has an invalid role',
    );
  }
  return {
    admin_id: admin.admin_id,
    username: admin.username,
    role: admin.role,
    totp_enabled: admin.totp_enabled_at !== null,
  };
}

@Injectable()
export class AdminAuthService {
  private readonly adminOrigins: string[];

  constructor(
    config: ConfigService,
    private readonly users: AdminUsersRepository,
    private readonly tokens: AdminTokenService,
    private readonly csrf: CsrfService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
  ) {
    this.adminOrigins = config.getOrThrow<string[]>('ADMIN_ORIGINS');
  }

  /**
   * Origin policy: guard-exempt auth endpoints require an allowed Origin, while
   * authenticated writes reject a present disallowed Origin but allow it to be absent
   * so non-browser clients and the documented logout test keep working.
   */
  assertAllowedOrigin(request: RequestWithContext, options: { required: boolean }): void {
    const origin = request.headers.origin;
    if (origin === undefined || origin.length === 0) {
      if (options.required) {
        throw this.forbidden('Origin header is required');
      }
      return;
    }
    if (!this.adminOrigins.includes(origin)) {
      throw this.forbidden('Origin is not allowed');
    }
  }

  async login(input: LoginDto, request: RequestWithContext): Promise<LoginResult> {
    const now = new Date();
    const meta = readRequestMeta(request);
    const admin = await this.users.findByUsername(input.username);

    if (admin === null) {
      // Real argon2 work for unknown usernames keeps response timing comparable.
      await this.passwords.verifyDummy(input.password);
      throw this.unauthenticated();
    }

    if (admin.locked_until !== null && admin.locked_until.getTime() > now.getTime()) {
      throw this.unauthenticated();
    }

    const passwordValid = await this.passwords.verify(admin.password_hash, input.password);
    if (!passwordValid) {
      await this.users.recordFailedPassword(admin, now);
      throw this.unauthenticated();
    }

    if (admin.status !== 'active') {
      throw this.unauthenticated();
    }

    await this.users.resetLoginFailures(admin.admin_id);

    if (admin.totp_enabled_at !== null && admin.totp_secret_encrypted !== null) {
      const mfaToken = await this.createMfaChallenge(admin.admin_id, meta, now);
      return { kind: 'mfa_required', body: { mfa_required: true, mfa_token: mfaToken } };
    }

    const profile = toAdminProfile(admin);
    if (profile.role === ADMIN_ROLE.SUPER_ADMIN) {
      const mfaToken = await this.createMfaChallenge(admin.admin_id, meta, now);
      return { kind: 'must_bind_totp', body: { must_bind_totp: true, mfa_token: mfaToken } };
    }

    return { kind: 'session', session: await this.completeLogin(admin, now) };
  }

  async setupTotp(mfaToken: string, request: RequestWithContext): Promise<TotpSetupResult> {
    const now = new Date();
    const { admin } = await this.loadMfaChallenge(mfaToken, readRequestMeta(request), now);
    if (admin.totp_enabled_at !== null) {
      throw this.conflict('TOTP is already enabled');
    }
    const secret = this.totp.generateSecret();
    await this.users.setPendingTotpSecret(admin.admin_id, this.totp.encryptSecret(secret));
    return {
      otpauth_uri: this.totp.buildUri(admin.username, secret),
      manual_key: secret,
    };
  }

  async enableTotp(
    mfaToken: string,
    code: string,
    request: RequestWithContext,
  ): Promise<TotpEnableResult> {
    const now = new Date();
    const { challenge, admin } = await this.loadMfaChallenge(
      mfaToken,
      readRequestMeta(request),
      now,
    );
    if (admin.totp_enabled_at !== null) {
      throw this.conflict('TOTP is already enabled');
    }
    const secret = this.readTotpSecret(admin);
    if (!this.totp.verify(secret, code)) {
      return this.failMfa(challenge);
    }

    const generated = await this.recoveryCodes.generate();
    const updated = await this.users.enableTotp(admin.admin_id, generated.hashes, now);
    await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
    const session = await this.completeLogin(updated, now);
    return { session, recovery_codes: generated.plain };
  }

  async verifyTotp(
    mfaToken: string,
    code: string,
    request: RequestWithContext,
  ): Promise<IssuedSession> {
    const now = new Date();
    const { challenge, admin } = await this.loadMfaChallenge(
      mfaToken,
      readRequestMeta(request),
      now,
    );
    if (admin.totp_enabled_at === null) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    const secret = this.readTotpSecret(admin);
    if (!this.totp.verify(secret, code)) {
      return this.failMfa(challenge);
    }
    await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
    return this.completeLogin(admin, now);
  }

  async loginWithRecoveryCode(
    mfaToken: string,
    recoveryCode: string,
    request: RequestWithContext,
  ): Promise<RecoveryLoginResult> {
    const now = new Date();
    const { challenge, admin } = await this.loadMfaChallenge(
      mfaToken,
      readRequestMeta(request),
      now,
    );
    if (admin.totp_enabled_at === null) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    const result = await this.recoveryCodes.consume(recoveryCode, admin.recovery_codes_hash);
    if (!result.consumed) {
      return this.failMfa(challenge, 'Invalid recovery code');
    }

    await this.users.saveRecoveryCodeHashes(admin.admin_id, result.remaining);
    await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
    const session = await this.completeLogin(admin, now);
    return { session, remaining_recovery_codes: result.remaining.length };
  }

  async refresh(refreshToken: string | undefined, request: RequestWithContext): Promise<IssuedSession> {
    const now = new Date();
    if (refreshToken === undefined) {
      throw this.unauthenticated(INVALID_REFRESH_MESSAGE);
    }
    const parsed = this.tokens.parseRefresh(refreshToken);
    if (parsed === null) {
      throw this.unauthenticated(INVALID_REFRESH_MESSAGE);
    }

    const admin = await this.users.findById(parsed.adminId);
    if (admin === null || admin.status !== 'active') {
      throw this.unauthenticated(INVALID_REFRESH_MESSAGE);
    }

    if (!this.tokens.refreshHashMatches(admin.refresh_token_hash, refreshToken)) {
      const meta = readRequestMeta(request);
      await this.users.revokeSessionsAndAudit(admin.admin_id, {
        adminId: admin.admin_id,
        action: 'auth.refresh_reuse',
        entityType: 'admin_user',
        entityId: admin.admin_id,
        after: { reason: 'refresh_token_reuse' },
        ip: meta.ip,
        requestId: meta.requestId,
        userAgent: meta.userAgent,
      });
      throw this.unauthenticated(INVALID_REFRESH_MESSAGE);
    }

    const sessionStartedAt = admin.session_started_at;
    const lastActiveAt = admin.last_active_at;
    if (
      sessionStartedAt === null ||
      lastActiveAt === null ||
      now.getTime() - sessionStartedAt.getTime() > ADMIN_SESSION_ABSOLUTE_MS ||
      now.getTime() - lastActiveAt.getTime() > ADMIN_SESSION_IDLE_MS
    ) {
      await this.users.clearSession(admin.admin_id);
      throw this.unauthenticated(INVALID_REFRESH_MESSAGE);
    }

    const nextRefreshToken = this.tokens.issueRefresh(admin.admin_id);
    await this.users.rotateRefreshToken(
      admin.admin_id,
      this.tokens.hashRefresh(nextRefreshToken),
      now,
    );

    const profile = toAdminProfile(admin);
    const access = this.tokens.issueAccess({
      admin_id: admin.admin_id,
      role: profile.role,
      token_version: admin.token_version,
    });
    return {
      accessToken: access.token,
      refreshToken: nextRefreshToken,
      csrf_token: this.csrf.generate(admin.admin_id, access.jti),
      admin: profile,
    };
  }

  async logout(admin: AdminContext): Promise<void> {
    await this.users.revokeSessions(admin.adminId);
  }

  async getMe(admin: AdminContext): Promise<MeResult> {
    const row = await this.users.findById(admin.adminId);
    if (row === null || row.status !== 'active' || row.token_version !== admin.tokenVersion) {
      throw this.unauthenticated();
    }
    return {
      admin: toAdminProfile(row),
      permissions: [],
      csrf_token: this.csrf.generate(admin.adminId, admin.jti),
    };
  }

  private async completeLogin(admin: AdminUser, now: Date): Promise<IssuedSession> {
    const profile = toAdminProfile(admin);
    const refreshToken = this.tokens.issueRefresh(admin.admin_id);
    const updated = await this.users.startSession(admin.admin_id, {
      refreshTokenHash: this.tokens.hashRefresh(refreshToken),
      now,
    });
    const access = this.tokens.issueAccess({
      admin_id: updated.admin_id,
      role: profile.role,
      // startSession already incremented token_version, so the access token carries the new one.
      token_version: updated.token_version,
    });
    return {
      accessToken: access.token,
      refreshToken,
      csrf_token: this.csrf.generate(updated.admin_id, access.jti),
      admin: toAdminProfile(updated),
    };
  }

  private async createMfaChallenge(
    adminId: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<string> {
    const mfaToken = randomBytes(32).toString('base64url');
    await this.users.createMfaChallenge({
      adminId,
      keyHash: sha256Hex(mfaToken),
      requestHash: requestDigest(meta),
      expiresAt: new Date(now.getTime() + MFA_TOKEN_TTL_MS),
    });
    return mfaToken;
  }

  private async loadMfaChallenge(
    mfaToken: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<{ challenge: IdempotencyKey; admin: AdminUser }> {
    const challenge = await this.users.findMfaChallenge(sha256Hex(mfaToken));
    if (challenge === null) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    if (challenge.expires_at.getTime() <= now.getTime()) {
      await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }

    const expectedDigest = Buffer.from(challenge.request_hash, 'hex');
    const actualDigest = Buffer.from(requestDigest(meta), 'hex');
    if (
      expectedDigest.length !== actualDigest.length ||
      !timingSafeEqual(expectedDigest, actualDigest)
    ) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }

    const admin = await this.users.findById(challenge.actor_id);
    if (admin === null || admin.status !== 'active') {
      await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    return { challenge, admin };
  }

  private async failMfa(challenge: IdempotencyKey, message = 'Invalid verification code'): Promise<never> {
    const attempts = readMfaAttempts(challenge.response_json) + 1;
    if (attempts >= MAX_MFA_ATTEMPTS) {
      await this.users.deleteMfaChallenge(challenge.actor_id, challenge.key);
    } else {
      await this.users.updateMfaAttempts(challenge.actor_id, challenge.key, attempts);
    }
    throw this.unauthenticated(message);
  }

  private readTotpSecret(admin: AdminUser): string {
    if (admin.totp_secret_encrypted === null) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    const secret = this.totp.decryptSecret(admin.totp_secret_encrypted);
    if (secret === null) {
      throw this.unauthenticated(INVALID_MFA_MESSAGE);
    }
    return secret;
  }

  private unauthenticated(message = GENERIC_LOGIN_MESSAGE): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, message);
  }

  private forbidden(message: string): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, message);
  }

  private conflict(message: string): AppError {
    return new AppError(ERROR_CODES.STATE_CONFLICT, HttpStatus.CONFLICT, message);
  }
}
