import { Injectable } from '@nestjs/common';
import { Prisma, type AdminUser, type IdempotencyKey } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

export const MFA_ACTOR_TYPE = 'admin_mfa';
export const MAX_FAILED_PASSWORDS = 5;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;

export interface StartSessionInput {
  refreshTokenHash: string;
  now: Date;
}

export interface AuditRecordInput {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
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
   * Counts one password failure. An expired lock restarts the count at one; reaching
   * five failed attempts locks the account for 15 minutes.
   */
  async recordFailedPassword(admin: AdminUser, now: Date): Promise<void> {
    const lockExpired =
      admin.locked_until !== null && admin.locked_until.getTime() <= now.getTime();
    const failedLoginCount = (lockExpired ? 0 : admin.failed_login_count) + 1;
    await this.prisma.adminUser.update({
      where: { admin_id: admin.admin_id },
      data: {
        failed_login_count: failedLoginCount,
        locked_until:
          failedLoginCount >= MAX_FAILED_PASSWORDS
            ? new Date(now.getTime() + PASSWORD_LOCK_MS)
            : null,
      },
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

  /** Refresh-token reuse revokes every session and records the security audit atomically. */
  async revokeSessionsAndAudit(adminId: string, audit: AuditRecordInput): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { admin_id: adminId },
        data: {
          token_version: { increment: 1 },
          refresh_token_hash: null,
          refresh_token_issued_at: null,
          session_started_at: null,
          last_active_at: null,
        },
      }),
      this.prisma.auditLog.create({ data: this.toAuditRow(audit) }),
    ]);
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

  async updateMfaAttempts(adminId: string, keyHash: string, attempts: number): Promise<void> {
    await this.prisma.idempotencyKey.update({
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

  async deleteMfaChallenge(adminId: string, keyHash: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { actor_type: MFA_ACTOR_TYPE, actor_id: adminId, key: keyHash },
    });
  }

  private toAuditRow(audit: AuditRecordInput): Prisma.AuditLogUncheckedCreateInput {
    return {
      log_id: ulid(),
      admin_id: audit.adminId,
      action: audit.action,
      entity_type: audit.entityType,
      entity_id: audit.entityId ?? null,
      ...(audit.before === undefined || audit.before === null
        ? {}
        : { before_json: audit.before }),
      ...(audit.after === undefined || audit.after === null
        ? {}
        : { after_json: audit.after }),
      ip: audit.ip ?? null,
      request_id: audit.requestId ?? null,
      user_agent: audit.userAgent ?? null,
    };
  }
}
