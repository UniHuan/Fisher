import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAuditLogInput {
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

export interface AuditLogFilters {
  adminId?: string;
  action?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface AuditLogPage {
  rows: AuditLog[];
  total: number;
}

/** Owns every Prisma query for the audit_log table; filtering and paging live in the service. */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      log_id: ulid(),
      admin_id: input.adminId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      ip: input.ip ?? null,
      request_id: input.requestId ?? null,
      user_agent: input.userAgent ?? null,
    };
    // Prisma treats a plain null on a nullable Json column as ambiguous, so omit it.
    if (input.before !== undefined && input.before !== null) {
      data.before_json = input.before;
    }
    if (input.after !== undefined && input.after !== null) {
      data.after_json = input.after;
    }
    await this.prisma.auditLog.create({ data });
  }

  async findPage(filters: AuditLogFilters): Promise<AuditLogPage> {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.adminId !== undefined) {
      where.admin_id = filters.adminId;
    }
    if (filters.action !== undefined) {
      where.action = filters.action;
    }
    if (filters.entityType !== undefined) {
      where.entity_type = filters.entityType;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      where.created_at = { gte: filters.from, lte: filters.to };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { log_id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  }
}
