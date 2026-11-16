import { Injectable } from '@nestjs/common';
import type { AdminUser, IdempotencyKey } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const MFA_ACTOR_TYPE = 'admin_mfa';
export const MAX_FAILED_PASSWORDS = 5;
export const MAX_MFA_ATTEMPTS = 5;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;
export const AUDIT_IP_MAX_LENGTH = 45;
export const AUDIT_USER_AGENT_MAX_LENGTH = 255;

interface FailedLoginRow {
  failed_login_count: number;
  locked_until: Date | null;
}

interface MfaAttemptRow {
  response_json: unknown;
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

export interface StartSessionInput {
  refreshTokenHash: string;
  now: Date;
}

export interface CreateMfaChallengeInput {
  adminId: string;
  keyHash: string;
  requestHash: string;
  expiresAt: Date;
}

@Injectable()
export class AdminUsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { username } });
  }

  findById(adminId: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { admin_id: adminId } });
  }

  /**
   * Counts one password failure under a row lock. An expired lock restarts the count
   * at one; reaching five failed attempts locks the account for 15 minutes. The lock
   * keeps parallel failures from over-counting or slipping past the fifth attempt.
   */
  async recordFailedPassword(adminId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<FailedLoginRow[]>`
        SELECT "failed_login_count", "locked_until"
        FROM "admin_user"
        WHERE "admin_id" = ${adminId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) {
        return;
      }
      if (row.locked_until !== null && row.locked_until.getTime() > now.getTime()) {
        return;
      }
      const lockExpired =
        row.locked_until !== null && row.locked_until.getTime() <= now.getTime();
      const failedLoginCount = (lockExpired ? 0 : row.failed_login_count) + 1;
      await tx.adminUser.update({
        where: { admin_id: adminId },
        data: {
          failed_login_count: failedLoginCount,
          locked_until:
            failedLoginCount >= MAX_FAILED_PASSWORDS
              ? new Date(now.getTime() + PASSWORD_LOCK_MS)
              : null,
        },
      });
    });
  }

  async resetLoginFailures(adminId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: { failed_login_count: 0, locked_until: null },
    });
  }

  /** Increments token_version first, then starts a fresh 8-hour session window. */
  startSession(adminId: string, input: StartSessionInput): Promise<AdminUser> {
    return this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: {
        token_version: { increment: 1 },
        refresh_token_hash: input.refreshTokenHash,
        refresh_token_issued_at: input.now,
        session_started_at: input.now,
        last_active_at: input.now,
        last_login_at: input.now,
        failed_login_count: 0,
        locked_until: null,
      },
    });
  }

  async rotateRefreshToken(adminId: string, hash: string, now: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: {
        refresh_token_hash: hash,
        refresh_token_issued_at: now,
        last_active_at: now,
      },
    });
  }

  async clearSession(adminId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: {
        refresh_token_hash: null,
        refresh_token_issued_at: null,
        session_started_at: null,
        last_active_at: null,
      },
    });
  }

  async revokeSessions(adminId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: {
        token_version: { increment: 1 },
        refresh_token_hash: null,
        refresh_token_issued_at: null,
        session_started_at: null,
        last_active_at: null,
      },
    });
  }

  async touchLastActive(adminId: string, now: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: { last_active_at: now },
    });
  }

  async setPendingTotpSecret(adminId: string, encryptedSecret: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: { totp_secret_encrypted: encryptedSecret },
    });
  }

  async enableTotp(adminId: string, recoveryCodeHashes: string[], now: Date): Promise<AdminUser> {
    return this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: { totp_enabled_at: now, recovery_codes_hash: recoveryCodeHashes },
    });
  }

  async saveRecoveryCodeHashes(adminId: string, hashes: string[]): Promise<void> {
    await this.prisma.adminUser.update({
      where: { admin_id: adminId },
      data: { recovery_codes_hash: hashes },
    });
  }

  /** Only the newest MFA challenge stays valid for an admin. */
  async createMfaChallenge(input: CreateMfaChallengeInput): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.idempotencyKey.deleteMany({
        where: { actor_type: MFA_ACTOR_TYPE, actor_id: input.adminId },
      }),
      this.prisma.idempotencyKey.create({
        data: {
          actor_type: MFA_ACTOR_TYPE,
          actor_id: input.adminId,
          key: input.keyHash,
          request_hash: input.requestHash,
          response_json: { attempts: 0 },
          expires_at: input.expiresAt,
        },
      }),
    ]);
  }

  findMfaChallenge(keyHash: string): Promise<IdempotencyKey | null> {
    return this.prisma.idempotencyKey.findFirst({
      where: { actor_type: MFA_ACTOR_TYPE, key: keyHash },
    });
  }

  /**
   * Atomically counts one failed MFA code under a row lock and deletes the challenge
   * on the fifth failure. Returns the new attempt count (zero when already consumed).
   */
  async registerMfaFailure(adminId: string, keyHash: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<MfaAttemptRow[]>`
        SELECT "response_json"
        FROM "idempotency_key"
        WHERE "actor_type" = ${MFA_ACTOR_TYPE}
          AND "actor_id" = ${adminId}
          AND "key" = ${keyHash}
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) {
        return 0;
      }
      const attempts = readMfaAttempts(row.response_json) + 1;
      if (attempts >= MAX_MFA_ATTEMPTS) {
        await tx.idempotencyKey.deleteMany({
          where: { actor_type: MFA_ACTOR_TYPE, actor_id: adminId, key: keyHash },
        });
      } else {
        await tx.idempotencyKey.update({
          where: {
            actor_type_actor_id_key: {
              actor_type: MFA_ACTOR_TYPE,
              actor_id: adminId,
              key: keyHash,
            },
          },
          data: { response_json: { attempts } },
        });
      }
      return attempts;
    });
  }

  async deleteMfaChallenge(adminId: string, keyHash: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { actor_type: MFA_ACTOR_TYPE, actor_id: adminId, key: keyHash },
    });
  }
}
