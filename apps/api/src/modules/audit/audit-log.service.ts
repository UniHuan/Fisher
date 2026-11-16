import { Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { ADMIN_ROLE, type Paginated } from '@szfisher/shared';
import type { AdminContext } from '../../common/types/request-context';
import {
  AUDIT_IP_MAX_LENGTH,
  AUDIT_USER_AGENT_MAX_LENGTH,
} from '../admin/admin-users.repository';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto';

export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 20;
export const AUDIT_LOG_REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|authorization|cookie|phone|mobile|refresh|access)/i;
const MAX_SANITIZE_DEPTH = 6;

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
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
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
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
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
