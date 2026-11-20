import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext } from '../../common/types/request-context';
import {
  decodeAdminCursor,
  encodeAdminCursor,
  type AdminQueueCursor,
} from '../admin-reports/admin-reports.repository';
import { PREVIEW_URL_TTL_SECONDS } from '../storage/storage.service';
import { PreviewSignerService } from '../uploads/preview-signer.service';
import { AdminFeedbackRepository, type AdminFeedbackRow } from './admin-feedback.repository';
import type { AdminFeedbackListQueryDto } from './dto/admin-feedback-list-query.dto';
import type {
  AdminFeedbackDetailDto,
  AdminFeedbackItemDto,
  AdminFeedbackPageDto,
  AdminFeedbackUpdateResponseDto,
} from './dto/admin-feedback-response.dto';
import type { UpdateFeedbackDto } from './dto/update-feedback.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DEVICE_INFO_KEYS = ['model', 'system', 'wechat_version', 'sdk_version'] as const;

function notFound(): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Feedback not found');
}

function validationError(field: string, message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message, [
    { field, message },
  ]);
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

function decodeCursor(cursor: string | undefined): AdminQueueCursor | null {
  if (cursor === undefined) {
    return null;
  }
  const decoded = decodeAdminCursor(cursor);
  if (decoded === null) {
    throw validationError('cursor', 'Invalid cursor');
  }
  return decoded;
}

/** Defense in depth: only the whitelisted string fields are ever returned. */
function toDeviceInfo(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of DEVICE_INFO_KEYS) {
    const entry = source[key];
    if (typeof entry === 'string' && entry !== '') {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

@Injectable()
export class AdminFeedbackService {
  constructor(
    private readonly repository: AdminFeedbackRepository,
    private readonly previewSigner: PreviewSignerService,
  ) {}

  async list(query: AdminFeedbackListQueryDto): Promise<AdminFeedbackPageDto> {
    const limit = pageSize(query.limit);
    const { rows, total, hasMore } = await this.repository.listFeedback({
      status: query.status,
      category: query.category,
      cursor: decodeCursor(query.cursor),
      limit,
    });
    const last = rows[rows.length - 1];
    return {
      items: rows.map((row) => this.toItem(row)),
      next_cursor:
        hasMore && last !== undefined
          ? encodeAdminCursor(last.created_at, last.feedback_id)
          : null,
      total,
    };
  }

  async detail(feedbackId: string): Promise<AdminFeedbackDetailDto> {
    const row = await this.repository.findFeedback(feedbackId);
    if (row === null) {
      throw notFound();
    }
    return this.toDetail(row);
  }

  async update(
    feedbackId: string,
    input: UpdateFeedbackDto,
    admin: AdminContext,
  ): Promise<AdminFeedbackUpdateResponseDto> {
    // `@IsOptional()` treats null as absent, so null is normalized here instead
    // of reaching `.trim()` or Prisma's non-nullable status column.
    const nextStatus = input.status ?? undefined;
    const providedNote = input.note ?? undefined;
    const nextNote = providedNote === undefined ? undefined : providedNote.trim() || null;
    if (nextStatus === undefined && nextNote === undefined) {
      throw validationError('body', 'At least one of status or note is required');
    }

    const updated = await this.repository.updateFeedback(
      feedbackId,
      admin.adminId,
      new Date(),
      { status: nextStatus, note: nextNote },
    );
    if (!updated) {
      throw notFound();
    }
    const status = await this.repository.findStatus(feedbackId);
    if (status === null) {
      throw notFound();
    }
    return { feedback_id: feedbackId, status };
  }

  private toItem(row: AdminFeedbackRow): AdminFeedbackItemDto {
    return {
      feedback_id: row.feedback_id,
      category: row.category,
      content: row.content,
      status: row.status,
      user_nickname: row.user.nickname,
      spot_id: row.spot_id,
      spot_name: row.spot?.spot_name ?? null,
      image_count: row.image_keys.length,
      created_at: row.created_at.toISOString(),
      handled_at: row.handled_at === null ? null : row.handled_at.toISOString(),
    };
  }

  private toDetail(row: AdminFeedbackRow): AdminFeedbackDetailDto {
    return {
      feedback_id: row.feedback_id,
      category: row.category,
      content: row.content,
      contact: row.contact,
      page: row.page,
      spot_id: row.spot_id,
      spot_name: row.spot?.spot_name ?? null,
      app_version: row.app_version,
      device_info: toDeviceInfo(row.device_info),
      images: this.imageUrls(row.image_keys),
      status: row.status,
      user_nickname: row.user.nickname,
      handler_id: row.handler_id,
      handled_at: row.handled_at === null ? null : row.handled_at.toISOString(),
      note: row.note,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  private imageUrls(imageKeys: string[]): string[] {
    const urls: string[] = [];
    for (const key of imageKeys) {
      try {
        urls.push(this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS).url);
      } catch {
        // Skip malformed legacy keys rather than failing the whole detail page.
      }
    }
    return urls;
  }
}
