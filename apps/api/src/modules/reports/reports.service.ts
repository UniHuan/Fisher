import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  MODERATION_STATUS,
  OPEN_STATUS,
  REPORT_CONTENT_TYPE,
  SPOT_STATUS,
} from '@szfisher/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AppUserContext } from '../../common/types/request-context';
import { ClientConfigService } from '../config/config.service';
import {
  CONTENT_SECURITY_PROVIDER,
  type ContentSecurityProvider,
  type ContentSecuritySuggest,
  type ContentSecurityTextResult,
} from '../content-security/content-security.types';
import { DictionariesRepository } from '../dictionaries/dictionaries.repository';
import type { RateLimitRule } from '../rate-limit/rate-limit.types';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { PreviewSignerService } from '../uploads/preview-signer.service';
import {
  type AbuseReportResponseDto,
  type DeleteReportResponseDto,
  type ReportLikeResponseDto,
} from './dto/abuse-report.dto';
import { REPORT_IMAGE_KEY_PATTERN, type CreateReportResponseDto } from './dto/create-report.dto';
import type { MyReportStatusFilter } from './dto/my-report-list-query.dto';
import type { MyReportItemDto } from './dto/my-report-response.dto';
import type { PublicReportItemDto } from './dto/public-report-response.dto';
import { decodeReportCursor, encodeReportCursor } from './report-cursor';
import {
  canOpenSpot,
  isPublicReportVisible,
  toMyReportItem,
  toPublicReportItem,
} from './report.mapper';
import { ReportModerationService } from './report-moderation.service';
import {
  ReportsRepository,
  type ActionReportView,
  type SpotVisibility,
} from './reports.repository';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
const MAX_CONTENT_CODE_POINTS = 500;
const NEW_USER_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_REPORT_RULE_SECONDS = 24 * 60 * 60;
const DAILY_REPORT_LIMIT = 10;
const NEW_USER_REPORT_LIMIT = 3;
const LIKE_RULE: RateLimitRule = { limit: 60, windowSeconds: 60 };
const ABUSE_DAILY_RULE: RateLimitRule = { limit: 20, windowSeconds: 24 * 60 * 60 };

export const PUBLIC_REPORT_STATUSES: readonly string[] = [
  MODERATION_STATUS.PUBLISHED,
  MODERATION_STATUS.HUMAN_APPROVED,
];

const MY_STATUS_GROUPS: Record<MyReportStatusFilter, readonly string[] | null> = {
  all: null,
  pending: [MODERATION_STATUS.MACHINE_PENDING],
  published: [MODERATION_STATUS.PUBLISHED, MODERATION_STATUS.HUMAN_APPROVED],
  rejected: [MODERATION_STATUS.MACHINE_REJECTED, MODERATION_STATUS.HUMAN_REJECTED],
  removed: [MODERATION_STATUS.REMOVED],
};

const CREATE_MESSAGES: Record<string, string> = {
  [MODERATION_STATUS.PUBLISHED]: '已发布',
  [MODERATION_STATUS.MACHINE_REJECTED]: '内容未通过审核',
  [MODERATION_STATUS.MACHINE_PENDING]: '内容审核中',
  [MODERATION_STATUS.REMOVED]: '内容不可发布',
};

export interface CreateReportConditionInput {
  open_status?: string;
  fee_status?: string;
  crowd_level?: string;
  facilities?: string[];
  observed_at?: string;
}

export interface CreateReportInput {
  spot_id: string;
  content_type: string;
  content: string;
  image_keys?: string[];
  fish_key?: string;
  catch_weight_kg?: number;
  condition?: CreateReportConditionInput;
  terms_version?: string;
}

export interface PublicReportPage {
  items: PublicReportItemDto[];
  next_cursor: string | null;
  total: number;
}

export interface MyReportPage {
  items: MyReportItemDto[];
  next_cursor: string | null;
  total: number;
}

interface ResolvedCondition {
  openStatus: string | null;
  feeStatus: string | null;
  crowdLevel: string | null;
  facilities: string[];
  observedAt: Date;
}

interface ContentShape {
  fishKey: string | null;
  catchWeightKg: number | null;
  condition: ResolvedCondition | null;
}

function validationError(field: string, message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message, [
    { field, message },
  ]);
}

function moderationStatusFor(suggest: ContentSecuritySuggest): string {
  if (suggest === 'pass') {
    return MODERATION_STATUS.PUBLISHED;
  }
  if (suggest === 'risky') {
    return MODERATION_STATUS.MACHINE_REJECTED;
  }
  return MODERATION_STATUS.MACHINE_PENDING;
}

function isSpotPubliclyVisible(spot: SpotVisibility): boolean {
  return canOpenSpot(spot);
}

function reportNotFoundError(): AppError {
  return new AppError(ERROR_CODES.REPORT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Content not found');
}

function reportForbiddenError(message: string): AppError {
  return new AppError(ERROR_CODES.REPORT_FORBIDDEN, HttpStatus.FORBIDDEN, message);
}

/** Fixed-window rate-limit keys mirror the spec: action, subject, window. */
function utcMinuteKey(now: Date): string {
  return now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly clientConfig: ClientConfigService,
    private readonly dictionaries: DictionariesRepository,
    private readonly rateLimit: RateLimitService,
    private readonly repository: ReportsRepository,
    private readonly moderation: ReportModerationService,
    private readonly previewSigner: PreviewSignerService,
    private readonly storage: StorageService,
    @Inject(CONTENT_SECURITY_PROVIDER)
    private readonly contentSecurity: ContentSecurityProvider,
  ) {}

  async create(
    input: CreateReportInput,
    appUser: AppUserContext | undefined,
  ): Promise<CreateReportResponseDto> {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    await this.assertUgcEnabled();

    const now = new Date();
    const user = await this.repository.findUser(appUser.userId);
    if (user === null) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    if (user.status !== 'active' || user.deleted_at !== null) {
      throw new AppError(
        ERROR_CODES.REPORT_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Account cannot publish',
      );
    }
    if (user.restricted_until !== null && user.restricted_until.getTime() > now.getTime()) {
      throw new AppError(
        ERROR_CODES.USER_RESTRICTED,
        HttpStatus.FORBIDDEN,
        'Publishing is restricted',
      );
    }

    const spot = await this.repository.findSpotVisibility(input.spot_id);
    if (spot === null || spot.status !== SPOT_STATUS.PUBLISHED || spot.deleted_at !== null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot is not available');
    }
    if (spot.open_status === OPEN_STATUS.BANNED) {
      throw new AppError(
        ERROR_CODES.SPOT_NOT_OPEN_FOR_UGC,
        HttpStatus.FORBIDDEN,
        'Spot is not open for UGC',
      );
    }

    const content = input.content.trim();
    const codePoints = Array.from(content).length;
    if (input.content_type === REPORT_CONTENT_TYPE.CONDITION) {
      if (codePoints > MAX_CONTENT_CODE_POINTS) {
        throw validationError(
          'content',
          `Content must be at most ${MAX_CONTENT_CODE_POINTS} characters`,
        );
      }
      if ((input.image_keys?.length ?? 0) > 3) {
        throw validationError('image_keys', 'Condition reports allow at most 3 images');
      }
    } else if (codePoints < 1 || codePoints > MAX_CONTENT_CODE_POINTS) {
      throw validationError('content', 'Content must be 1 to 500 characters');
    }
    const shape = await this.resolveContentShape(input, now);
    const imageKeys = await this.resolveImageKeys(input.image_keys, user.user_id);

    const termsVersion = this.config.get<string>('UGC_TERMS_VERSION')?.trim() ?? '';
    if (termsVersion === '') {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'UGC terms version is not configured',
      );
    }
    const providedTerms = input.terms_version?.trim();
    const needsAcceptance = user.terms_accepted_at === null || user.terms_version !== termsVersion;
    if (needsAcceptance) {
      if (providedTerms === undefined || providedTerms !== termsVersion) {
        throw validationError('terms_version', 'The current terms version must be accepted');
      }
    } else if (providedTerms !== undefined && providedTerms !== termsVersion) {
      throw validationError('terms_version', 'Unsupported terms version');
    }

    await this.enforceDailyLimit(user.user_id, user.created_at, now);

    const reportId = ulid();
    await this.repository.createReport({
      reportId,
      spotId: input.spot_id,
      userId: user.user_id,
      contentType: input.content_type,
      content,
      imageKeys,
      fishKey: shape.fishKey,
      catchWeightKg: shape.catchWeightKg,
      conditionOpenStatus: shape.condition?.openStatus ?? null,
      conditionFeeStatus: shape.condition?.feeStatus ?? null,
      conditionCrowdLevel: shape.condition?.crowdLevel ?? null,
      conditionFacilities: shape.condition?.facilities ?? [],
      observedAt: shape.condition?.observedAt ?? null,
      createdAt: now,
      usedAt: now,
      terms: needsAcceptance ? { version: termsVersion, acceptedAt: now } : null,
    });

    const result = content === '' ? null : await this.checkText(content, appUser.openid);
    let moderationStatus =
      result === null
        ? imageKeys.length > 0
          ? MODERATION_STATUS.MACHINE_PENDING
          : MODERATION_STATUS.PUBLISHED
        : result.suggest === 'pass' && imageKeys.length > 0
          ? MODERATION_STATUS.MACHINE_PENDING
          : moderationStatusFor(result.suggest);
    // The write is conditional: a concurrent ban or human decision wins, and
    // the returned status is the row's real current status.
    moderationStatus = await this.repository.updateModeration(
      reportId,
      moderationStatus,
      result === null ? { skipped: 'structured_only' } : toMachineResult(result),
      now,
    );

    // Text `pass` and `review` both submit images; only `risky` rejects without
    // checking them. A review report still cannot publish: recompute requires a
    // stored text `pass`, so it waits for a human even if every image passes.
    if ((result === null || result.suggest !== 'risky') && imageKeys.length > 0) {
      try {
        await this.moderation.submitImages(reportId, imageKeys, appUser.openid);
      } catch {
        this.logger.warn('Image moderation submission failed; report stays pending');
      }
      moderationStatus =
        (await this.repository.findModerationStatus(reportId)) ?? MODERATION_STATUS.MACHINE_PENDING;
    }

    return {
      report_id: reportId,
      moderation_status: moderationStatus,
      message: CREATE_MESSAGES[moderationStatus] ?? '内容审核中',
    };
  }

  async like(
    reportId: string,
    appUser: AppUserContext | undefined,
  ): Promise<ReportLikeResponseDto> {
    const user = this.requireAppUser(appUser);
    await this.assertUgcEnabled();
    await this.requireVisibleReport(reportId);
    const now = new Date();
    await this.enforceActionLimit(
      `like:user:${user.userId}:${utcMinuteKey(now)}`,
      LIKE_RULE,
      'Like rate limit reached',
    );
    const likeCount = await this.repository.likeReport(
      reportId,
      user.userId,
      PUBLIC_REPORT_STATUSES,
    );
    if (likeCount === null) {
      throw reportNotFoundError();
    }
    return { liked: true, like_count: likeCount };
  }

  async unlike(
    reportId: string,
    appUser: AppUserContext | undefined,
  ): Promise<ReportLikeResponseDto> {
    const user = this.requireAppUser(appUser);
    await this.assertUgcEnabled();
    await this.requireVisibleReport(reportId);
    const now = new Date();
    await this.enforceActionLimit(
      `like:user:${user.userId}:${utcMinuteKey(now)}`,
      LIKE_RULE,
      'Like rate limit reached',
    );
    const likeCount = await this.repository.unlikeReport(reportId, user.userId);
    if (likeCount === null) {
      throw reportNotFoundError();
    }
    return { liked: false, like_count: likeCount };
  }

  async reportAbuse(
    reportId: string,
    input: { reason: string },
    appUser: AppUserContext | undefined,
  ): Promise<AbuseReportResponseDto> {
    const user = this.requireAppUser(appUser);
    await this.assertUgcEnabled();
    const report = await this.requireVisibleReport(reportId);
    if (report.user_id === user.userId) {
      throw reportForbiddenError('Cannot report your own content');
    }
    const now = new Date();
    await this.enforceActionLimit(
      `abuse:user:${user.userId}:${utcDayKey(now)}`,
      ABUSE_DAILY_RULE,
      'Daily abuse report limit reached',
    );
    await this.repository.createAbuse({
      abuseId: ulid(),
      reportId,
      userId: user.userId,
      reason: input.reason,
      createdAt: now,
    });
    return { reported: true };
  }

  async deleteReport(
    reportId: string,
    appUser: AppUserContext | undefined,
  ): Promise<DeleteReportResponseDto> {
    const user = this.requireAppUser(appUser);
    await this.assertUgcEnabled();
    const report = await this.repository.findActionReport(reportId);
    if (report === null || report.deleted_at !== null) {
      throw reportNotFoundError();
    }
    if (report.user_id !== user.userId) {
      throw reportForbiddenError('Only the author can delete this content');
    }
    const now = new Date();
    const marked = await this.repository.markAuthorDeleted(reportId, report.images, now);
    if (!marked) {
      throw reportNotFoundError();
    }
    // The row is already tombstoned, so a storage failure cannot keep the
    // content public. Keep `images` as the durable retry pointer for the purge
    // job and clear it only once both buckets accepted every delete.
    const removed = await this.removeStoredImages(report.report_id, report.images);
    if (removed) {
      await this.repository.clearReportImages(report.report_id);
    }
    return { deleted: true };
  }

  async listPublic(
    spotId: string,
    query: { content_type?: string; cursor?: string; limit?: number },
    appUser: AppUserContext | undefined,
  ): Promise<PublicReportPage> {
    if (!(await this.isUgcEnabled())) {
      return { items: [], next_cursor: null, total: 0 };
    }
    const spot = await this.repository.findSpotVisibility(spotId);
    if (spot === null || !isSpotPubliclyVisible(spot)) {
      return { items: [], next_cursor: null, total: 0 };
    }

    const limit = this.pageSize(query.limit);
    const cursor = this.decodeCursor(query.cursor);
    const { rows, total, likedReportIds, hasMore } = await this.repository.listPublic({
      spotId,
      contentType: query.content_type,
      statuses: PUBLIC_REPORT_STATUSES,
      cursor,
      limit,
      viewerId: appUser?.userId,
    });

    return {
      items: rows.map((row) => toPublicReportItem(row, appUser?.userId, likedReportIds)),
      next_cursor: this.nextCursor(rows, hasMore),
      total,
    };
  }

  async listMine(
    query: { status?: MyReportStatusFilter; cursor?: string; limit?: number },
    appUser: AppUserContext | undefined,
  ): Promise<MyReportPage> {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    const status = query.status ?? 'all';
    const limit = this.pageSize(query.limit);
    const cursor = this.decodeCursor(query.cursor);
    const { rows, total, hasMore } = await this.repository.listMine({
      userId: appUser.userId,
      statuses: MY_STATUS_GROUPS[status],
      cursor,
      limit,
    });

    return {
      items: rows.map((row) =>
        toMyReportItem(
          row,
          (key) => this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS).url,
        ),
      ),
      next_cursor: this.nextCursor(rows, hasMore),
      total,
    };
  }

  private requireAppUser(appUser: AppUserContext | undefined): AppUserContext {
    if (appUser === undefined) {
      throw new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    return appUser;
  }

  private async requireVisibleReport(reportId: string): Promise<ActionReportView> {
    const report = await this.repository.findActionReport(reportId);
    if (report === null || !isPublicReportVisible(report, report.spot)) {
      throw reportNotFoundError();
    }
    return report;
  }

  private async enforceActionLimit(
    key: string,
    rule: RateLimitRule,
    message: string,
  ): Promise<void> {
    const decision = await this.rateLimit.hit(key, rule);
    if (!decision.allowed) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, message);
    }
  }

  /**
   * Attempts every object delete. Returns false when any bucket call failed so
   * the caller can keep the report's `images` retry pointer for the purge job.
   * Keys and user ids are never logged.
   */
  private async removeStoredImages(reportId: string, imageKeys: string[]): Promise<boolean> {
    let allRemoved = true;
    for (const key of imageKeys) {
      const basename = key.split('/').pop() ?? '';
      if (basename !== '') {
        try {
          await this.storage.deletePublished(`ugc/${reportId}/${basename}`);
        } catch {
          allRemoved = false;
          this.logger.warn('Published image removal failed; the purge job will retry');
        }
      }
      try {
        await this.storage.deleteObject(key);
      } catch {
        allRemoved = false;
        this.logger.warn('Work image removal failed; the purge job will retry');
      }
    }
    return allRemoved;
  }

  private async resolveImageKeys(
    imageKeys: string[] | undefined,
    userId: string,
  ): Promise<string[]> {
    const unique = [...new Set(imageKeys ?? [])];
    if (unique.length > 6) {
      throw validationError('image_keys', 'At most 6 images are allowed');
    }
    if (unique.length === 0) {
      return [];
    }
    for (const key of unique) {
      if (!key.startsWith(`ugc/${userId}/`) || !REPORT_IMAGE_KEY_PATTERN.test(key)) {
        throw validationError('image_keys', 'Image keys must belong to the current user');
      }
    }
    const owned = await this.repository.findPendingUploadKeys(userId, unique);
    if (owned.length !== unique.length) {
      throw validationError(
        'image_keys',
        'Image keys must be pending uploads owned by the current user',
      );
    }
    return unique;
  }

  private async resolveContentShape(
    input: CreateReportInput,
    now: Date,
  ): Promise<ContentShape> {
    switch (input.content_type) {
      case REPORT_CONTENT_TYPE.COMMENT:
      case REPORT_CONTENT_TYPE.INTEL:
        if (input.fish_key !== undefined || input.catch_weight_kg !== undefined) {
          throw validationError(
            'content_type',
            'Only catch content may include fish_key or catch_weight_kg',
          );
        }
        if (input.condition !== undefined) {
          throw validationError('condition', 'Only condition content may include condition fields');
        }
        return { fishKey: null, catchWeightKg: null, condition: null };
      case REPORT_CONTENT_TYPE.CATCH: {
        const fishKey = input.fish_key?.trim() ?? '';
        if (fishKey === '') {
          throw validationError('fish_key', 'Catch content requires a fish_key');
        }
        const fish = await this.dictionaries.findByKey('fish_type', fishKey);
        if (fish === null || !fish.enabled) {
          throw validationError('fish_key', 'Unknown or disabled fish_key');
        }
        return { fishKey, catchWeightKg: input.catch_weight_kg ?? null, condition: null };
      }
      case REPORT_CONTENT_TYPE.CONDITION:
        if (input.fish_key !== undefined || input.catch_weight_kg !== undefined) {
          throw validationError(
            'content_type',
            'Condition content cannot include fish_key or catch_weight_kg',
          );
        }
        return {
          fishKey: null,
          catchWeightKg: null,
          condition: this.resolveCondition(input, now),
        };
      default:
        throw validationError('content_type', 'Unsupported content type');
    }
  }

  private resolveCondition(input: CreateReportInput, now: Date): ResolvedCondition {
    if (input.condition === undefined) {
      throw validationError('condition', 'Condition content requires condition fields');
    }
    const facilities = [...new Set(input.condition.facilities ?? [])];
    if (facilities.length > 6) {
      throw validationError('facilities', 'At most 6 facilities are allowed');
    }
    const hasAny =
      input.condition.open_status !== undefined ||
      input.condition.fee_status !== undefined ||
      input.condition.crowd_level !== undefined ||
      facilities.length > 0;
    if (!hasAny) {
      throw validationError('condition', 'At least one condition field is required');
    }
    let observedAt = now;
    if (input.condition.observed_at !== undefined) {
      observedAt = new Date(input.condition.observed_at);
      if (Number.isNaN(observedAt.getTime())) {
        throw validationError('observed_at', 'Invalid observation time');
      }
      const delta = now.getTime() - observedAt.getTime();
      if (delta < -5 * 60 * 1000 || delta > 24 * 60 * 60 * 1000) {
        throw validationError('observed_at', 'Observation time must be within 24 hours');
      }
    }
    return {
      openStatus: input.condition.open_status ?? null,
      feeStatus: input.condition.fee_status ?? null,
      crowdLevel: input.condition.crowd_level ?? null,
      facilities,
      observedAt,
    };
  }

  private async enforceDailyLimit(userId: string, createdAt: Date, now: Date): Promise<void> {
    const isNewUser = now.getTime() - createdAt.getTime() < NEW_USER_WINDOW_MS;
    const decision = await this.rateLimit.hit(
      `report:user:${userId}:${now.toISOString().slice(0, 10).replace(/-/g, '')}`,
      {
        limit: isNewUser ? NEW_USER_REPORT_LIMIT : DAILY_REPORT_LIMIT,
        windowSeconds: DAILY_REPORT_RULE_SECONDS,
      },
      now,
    );
    if (!decision.allowed) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
        'Daily posting limit reached',
      );
    }
  }

  private async checkText(content: string, openid: string): Promise<ContentSecurityTextResult> {
    try {
      return await this.contentSecurity.checkText({ content, openid });
    } catch {
      // A moderation outage must never publish; it goes to the human queue.
      this.logger.warn('Text moderation failed; routing content to human review');
      return { suggest: 'review', errorCode: 'provider-error' };
    }
  }

  private async assertUgcEnabled(): Promise<void> {
    if (!(await this.isUgcEnabled())) {
      throw new AppError(ERROR_CODES.FEATURE_DISABLED, HttpStatus.FORBIDDEN, 'UGC is disabled');
    }
  }

  private async isUgcEnabled(): Promise<boolean> {
    const config = await this.clientConfig.getClientConfig();
    return config.features.ugc;
  }

  private pageSize(limit: number | undefined): number {
    if (limit === undefined) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  }

  private decodeCursor(cursor: string | undefined) {
    if (cursor === undefined) {
      return null;
    }
    const decoded = decodeReportCursor(cursor);
    if (decoded === null) {
      throw validationError('cursor', 'Invalid cursor');
    }
    return decoded;
  }

  private nextCursor(
    rows: ReadonlyArray<{ created_at: Date; report_id: string }>,
    hasMore: boolean,
  ): string | null {
    if (!hasMore) {
      return null;
    }
    const last = rows[rows.length - 1];
    return last === undefined ? null : encodeReportCursor(last.created_at, last.report_id);
  }
}

function toMachineResult(result: ContentSecurityTextResult): Prisma.InputJsonObject {
  // Only the conclusion, label, trace id and safe error code are persisted:
  // no content or openid.
  return {
    suggest: result.suggest,
    ...(result.label === undefined ? {} : { label: result.label }),
    ...(result.traceId === undefined ? {} : { trace_id: result.traceId }),
    ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }),
  };
}
