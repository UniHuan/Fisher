import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminQueueCursor } from '../admin-reports/admin-reports.repository';

export interface AdminFeedbackRow {
  feedback_id: string;
  user_id: string;
  category: string;
  content: string;
  contact: string | null;
  page: string | null;
  spot_id: string | null;
  app_version: string | null;
  device_info: Prisma.JsonValue | null;
  image_keys: string[];
  status: string;
  handler_id: string | null;
  handled_at: Date | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  user: { nickname: string | null };
  spot: { spot_name: string } | null;
}

export interface AdminFeedbackListParams {
  status?: string;
  category?: string;
  cursor: AdminQueueCursor | null;
  limit: number;
}

export interface AdminFeedbackListResult {
  rows: AdminFeedbackRow[];
  total: number;
  hasMore: boolean;
}

export interface AdminFeedbackUpdateInput {
  status?: string;
  /** Trimmed note; null clears it. */
  note?: string | null;
}

const ADMIN_FEEDBACK_SELECT = {
  feedback_id: true,
  user_id: true,
  category: true,
  content: true,
  contact: true,
  page: true,
  spot_id: true,
  app_version: true,
  device_info: true,
  image_keys: true,
  status: true,
  handler_id: true,
  handled_at: true,
  note: true,
  created_at: true,
  updated_at: true,
  user: { select: { nickname: true } },
  spot: { select: { spot_name: true } },
} satisfies Prisma.TrialFeedbackSelect;

const FEEDBACK_ORDER: Prisma.TrialFeedbackOrderByWithRelationInput[] = [
  { created_at: 'desc' },
  { feedback_id: 'desc' },
];

/** Owns every Prisma query for the admin feedback module. */
@Injectable()
export class AdminFeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  findFeedback(feedbackId: string): Promise<AdminFeedbackRow | null> {
    return this.prisma.trialFeedback.findUnique({
      where: { feedback_id: feedbackId },
      select: ADMIN_FEEDBACK_SELECT,
    });
  }

  async listFeedback(params: AdminFeedbackListParams): Promise<AdminFeedbackListResult> {
    const base: Prisma.TrialFeedbackWhereInput = {
      ...(params.status === undefined ? {} : { status: params.status }),
      ...(params.category === undefined ? {} : { category: params.category }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.trialFeedback.findMany({
        where: withCursor(base, params.cursor),
        select: ADMIN_FEEDBACK_SELECT,
        orderBy: FEEDBACK_ORDER,
        take: params.limit + 1,
      }),
      this.prisma.trialFeedback.count({ where: base }),
    ]);
    const hasMore = rows.length > params.limit;
    return { rows: hasMore ? rows.slice(0, params.limit) : rows, total, hasMore };
  }

  /**
   * Applies a handling update and records the admin and time. Returns false when
   * the feedback disappeared between the detail read and this write.
   */
  async updateFeedback(
    feedbackId: string,
    adminId: string,
    now: Date,
    input: AdminFeedbackUpdateInput,
  ): Promise<boolean> {
    const updated = await this.prisma.trialFeedback.updateMany({
      where: { feedback_id: feedbackId },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.note === undefined ? {} : { note: input.note }),
        handler_id: adminId,
        handled_at: now,
      },
    });
    return updated.count > 0;
  }

  async findStatus(feedbackId: string): Promise<string | null> {
    const row = await this.prisma.trialFeedback.findUnique({
      where: { feedback_id: feedbackId },
      select: { status: true },
    });
    return row?.status ?? null;
  }
}

function withCursor(
  base: Prisma.TrialFeedbackWhereInput,
  cursor: AdminQueueCursor | null,
): Prisma.TrialFeedbackWhereInput {
  if (cursor === null) {
    return base;
  }
  return {
    ...base,
    OR: [
      { created_at: { lt: cursor.createdAt } },
      { created_at: cursor.createdAt, feedback_id: { lt: cursor.id } },
    ],
  };
}
