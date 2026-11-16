import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { ADMIN_ROLE, ERROR_CODES, type Paginated } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext } from '../../common/types/request-context';
import {
  AUDIT_IP_MAX_LENGTH,
  AUDIT_USER_AGENT_MAX_LENGTH,
} from '../admin/admin-users.repository';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto';

export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 20;
export const AUDIT_LOG_REDACTED = '[REDACTED]';
// audit_log columns are varchar(64); callers may build longer composite ids.
export const AUDIT_ACTION_MAX_LENGTH = 64;
export const AUDIT_ENTITY_TYPE_MAX_LENGTH = 64;
export const AUDIT_ENTITY_ID_MAX_LENGTH = 64;

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|authorization|cookie|phone|mobile|refresh|access)/i;
const MAX_SANITIZE_DEPTH = 6;

/**
 * Values that are secret or personal data regardless of their key name. Ordinary
 * labels such as 测试钓点 do not match any pattern and stay readable.
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  // Chinese mainland mobile numbers.
  /1[3-9]\d{9}/,
  // Email addresses.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/,
  // Bearer credentials embedded in a string.
  /\bBearer\s+\S+/i,
  // JWT-like values start with the base64url of `{"` (eyJ...).
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/,
  // Long hex strings (hashes, refresh tokens, API keys).
  /\b[0-9a-fA-F]{32,}\b/,
  // Long unbroken base64url-like values (opaque tokens, keys, signatures).
  /[A-Za-z0-9_-]{40,}/,
];

/** True when the whole string must be replaced with [REDACTED]. */
export function isSensitiveAuditValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function redactString(value: string): string {
  return isSensitiveAuditValue(value) ? AUDIT_LOG_REDACTED : value;
}

export interface AuditInput {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
}

export interface AuditLogItem {
  log_id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: Prisma.JsonValue | null;
  after_json: Prisma.JsonValue | null;
  ip: string | null;
  request_id: string | null;
  user_agent: string | null;
  created_at: string;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively redacts sensitive keys and keeps the payload JSON-safe. Arrays and plain
 * objects are copied; deeper than MAX_SANITIZE_DEPTH is collapsed so payloads stay bounded.
 */
export function sanitizeAuditPayload(
  value: unknown,
  depth = 0,
): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return AUDIT_LOG_REDACTED;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditPayload(item, depth + 1));
  }
  if (typeof value === 'object' && isPlainObject(value)) {
    const sanitized: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? AUDIT_LOG_REDACTED
        : sanitizeAuditPayload(item, depth + 1);
    }
    return sanitized as Prisma.InputJsonObject;
  }
  return String(value);
}

function toAuditLogItem(row: AuditLog): AuditLogItem {
  return {
    log_id: row.log_id,
    admin_id: row.admin_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    before_json: row.before_json,
    after_json: row.after_json,
    ip: row.ip,
    request_id: row.request_id,
    user_agent: row.user_agent,
    created_at: row.created_at.toISOString(),
  };
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly logs: AuditLogRepository) {}

  /**
   * Best-effort audit write. A failed insert is logged with its request_id but never
   * fails the business operation that produced it.
   */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.logs.create({
        adminId: input.adminId,
        action: input.action.slice(0, AUDIT_ACTION_MAX_LENGTH),
        entityType: input.entityType.slice(0, AUDIT_ENTITY_TYPE_MAX_LENGTH),
        entityId:
          input.entityId === undefined || input.entityId === null
            ? null
            : input.entityId.slice(0, AUDIT_ENTITY_ID_MAX_LENGTH),
        before: sanitizeAuditPayload(input.before),
        after: sanitizeAuditPayload(input.after),
        ip:
          input.ip === undefined || input.ip === null
            ? null
            : input.ip.slice(0, AUDIT_IP_MAX_LENGTH),
        requestId: input.requestId ?? null,
        userAgent:
          input.userAgent === undefined || input.userAgent === null
            ? null
            : input.userAgent.slice(0, AUDIT_USER_AGENT_MAX_LENGTH),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `request_id=${input.requestId ?? 'unknown'} action=${input.action} failed to write audit log: ${message}`,
      );
    }
  }

  async list(admin: AdminContext, query: AuditLogQueryDto): Promise<Paginated<AuditLogItem>> {
    // Default deny: the service, not just the controller, owns who may read the trail.
    if (admin.role !== ADMIN_ROLE.SUPER_ADMIN && admin.role !== ADMIN_ROLE.OPERATOR) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Insufficient permissions',
      );
    }

    const page = query.page ?? 1;
    const pageSize = query.page_size ?? AUDIT_LOG_DEFAULT_PAGE_SIZE;
    // Operators are scoped to their own trail regardless of any admin_id they send.
    const adminId = admin.role === ADMIN_ROLE.OPERATOR ? admin.adminId : query.admin_id;

    const { rows, total } = await this.logs.findPage({
      adminId,
      action: query.action,
      entityType: query.entity_type,
      from: query.from === undefined ? undefined : new Date(query.from),
      to: query.to === undefined ? undefined : new Date(query.to),
      page,
      pageSize,
    });

    return {
      items: rows.map(toAuditLogItem),
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    };
  }
}
