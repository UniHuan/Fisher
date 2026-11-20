import {
  ABUSE_REASON,
  ADMIN_ROLE,
  CLIENT_TYPE,
  ERROR_CODES,
  FEEDBACK_CATEGORY,
  FEEDBACK_IMAGE_STATUS,
  FEEDBACK_STATUS,
  MODERATION_STATUS,
  OPEN_STATUS,
  POI_TYPE,
  REPORT_CONTENT_TYPE,
  SPOT_STATUS,
  UGC_UPLOAD_STATUS,
  fail,
  isShenzhenCoordinate,
  isUlid,
  normalizeKeyword,
  ok,
  splitCsv,
} from './index';
import type {
  AdminRole,
  ApiResponse,
  ClientType,
  FeedbackCategory,
  FeedbackImageStatus,
  FeedbackStatus,
  OpenStatus,
  Paginated,
  PoiType,
  SpotStatus,
  ValidationIssue,
} from './index';

describe('shared contract', () => {
  it('keeps stable business codes', () => {
    expect(ERROR_CODES.VALIDATION).toBe(40001);
    expect(ERROR_CODES.PUBLISH_VALIDATION).toBe(42201);
  });

  it.each([
    ['SUCCESS', 0],
    ['VALIDATION', 40001],
    ['UNAUTHENTICATED', 40101],
    ['TOKEN_EXPIRED', 40102],
    ['FORBIDDEN', 40301],
    ['NOT_FOUND', 40401],
    ['STATE_CONFLICT', 40901],
    ['IDEMPOTENCY_CONFLICT', 40902],
    ['PAYLOAD_TOO_LARGE', 41301],
    ['PUBLISH_VALIDATION', 42201],
    ['RATE_LIMITED', 42901],
    ['INTERNAL', 50001],
    ['DEPENDENCY_UNAVAILABLE', 50301],
  ] as const)('exposes %s as %i', (name, value) => {
    expect(ERROR_CODES[name]).toBe(value);
  });

  it('exposes the UGC error codes', () => {
    expect(ERROR_CODES.FEATURE_DISABLED).toBe(40302);
    expect(ERROR_CODES.SPOT_NOT_OPEN_FOR_UGC).toBe(40303);
    expect(ERROR_CODES.REPORT_FORBIDDEN).toBe(40304);
    expect(ERROR_CODES.USER_RESTRICTED).toBe(40305);
    expect(ERROR_CODES.REPORT_NOT_FOUND).toBe(40402);
  });

  it('exposes exactly the eighteen business codes', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(18);
  });

  it('keeps enum values stable', () => {
    expect(OPEN_STATUS).toEqual({ OPEN: 'open', PAUSED: 'paused', BANNED: 'banned' });
    expect(SPOT_STATUS).toEqual({ DRAFT: 'draft', PUBLISHED: 'published', OFFLINE: 'offline' });
    expect(POI_TYPE).toEqual({
      FOOD: 'food',
      PARKING: 'parking',
      TOILET: 'toilet',
      SUPPLY: 'supply',
      ENTERTAINMENT: 'entertainment',
      LODGING: 'lodging',
    });
    expect(ADMIN_ROLE).toEqual({
      SUPER_ADMIN: 'super_admin',
      OPERATOR: 'operator',
      REVIEWER: 'reviewer',
    });
    expect(CLIENT_TYPE).toEqual({ MINIPROGRAM: 'miniprogram', IOS: 'ios', ADMIN: 'admin' });
  });

  it('types enum union members', () => {
    const openStatus: OpenStatus = OPEN_STATUS.OPEN;
    const spotStatus: SpotStatus = SPOT_STATUS.PUBLISHED;
    const poiType: PoiType = POI_TYPE.FOOD;
    const adminRole: AdminRole = ADMIN_ROLE.SUPER_ADMIN;
    const clientType: ClientType = CLIENT_TYPE.MINIPROGRAM;

    expect([openStatus, spotStatus, poiType, adminRole, clientType]).toEqual([
      'open',
      'published',
      'food',
      'super_admin',
      'miniprogram',
    ]);
  });

  it('exposes the UGC enums', () => {
    expect(REPORT_CONTENT_TYPE).toEqual({ COMMENT: 'comment', CATCH: 'catch', INTEL: 'intel' });
    expect(MODERATION_STATUS.HUMAN_APPROVED).toBe('human_approved');
    expect(ABUSE_REASON).toEqual({
      AD: 'ad', ABUSE: 'abuse', FALSE_INFO: 'false_info', PRIVACY: 'privacy', OTHER: 'other',
    });
    expect(UGC_UPLOAD_STATUS).toEqual({ PENDING: 'pending', USED: 'used', DELETED: 'deleted' });
  });

  it('exposes the trial feedback enums', () => {
    expect(FEEDBACK_CATEGORY).toEqual({
      BUG: 'bug',
      SUGGESTION: 'suggestion',
      CONTENT: 'content',
      PHOTO: 'photo',
      OTHER: 'other',
    });
    expect(FEEDBACK_STATUS).toEqual({
      OPEN: 'open',
      REVIEWING: 'reviewing',
      RESOLVED: 'resolved',
      CLOSED: 'closed',
    });
    expect(FEEDBACK_IMAGE_STATUS).toEqual({
      PENDING: 'pending',
      USED: 'used',
      DELETED: 'deleted',
    });
  });

  it('types the trial feedback enum union members', () => {
    const category: FeedbackCategory = FEEDBACK_CATEGORY.PHOTO;
    const status: FeedbackStatus = FEEDBACK_STATUS.REVIEWING;
    const imageStatus: FeedbackImageStatus = FEEDBACK_IMAGE_STATUS.DELETED;

    expect([category, status, imageStatus]).toEqual(['photo', 'reviewing', 'deleted']);
  });

  it('wraps success and failure', () => {
    expect(ok({ a: 1 }, 'req_1')).toEqual({
      code: 0,
      message: 'ok',
      data: { a: 1 },
      request_id: 'req_1',
    });
    expect(fail(40401, 'not found', 'req_2').code).toBe(40401);
  });

  it('omits details when not provided and keeps them when provided', () => {
    const plain = fail(40401, 'not found', 'req_2');
    expect(plain).toEqual({ code: 40401, message: 'not found', data: null, request_id: 'req_2' });
    expect('details' in plain).toBe(false);

    const issue: ValidationIssue = { field: 'spot_name', message: 'required' };
    expect(fail(42201, 'validation failed', 'req_3', [issue])).toEqual({
      code: 42201,
      message: 'validation failed',
      data: null,
      request_id: 'req_3',
      details: [{ field: 'spot_name', message: 'required' }],
    });
  });

  it('expresses envelope and pagination types', () => {
    const response: ApiResponse<{ a: number }> = ok({ a: 1 }, 'req_1');
    const empty: ApiResponse<null> = { code: 0, message: 'ok', data: null, request_id: 'req_0' };
    const page: Paginated<{ id: number }> = {
      items: [{ id: 1 }],
      page: 1,
      page_size: 20,
      total: 1,
      has_more: false,
    };

    expect(response.data).toEqual({ a: 1 });
    expect(empty.data).toBeNull();
    expect(page.items).toHaveLength(1);
  });

  it('validates ULID', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(isUlid('not-a-ulid')).toBe(false);
  });

  it('accepts only 26-character uppercase Crockford Base32 ULIDs', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVX')).toBe(false);
    expect(isUlid('01arz3ndektsv4rrffq69g5fav')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAL')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false);
    expect(isUlid('81ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(false);
  });

  it('limits coordinates to Shenzhen', () => {
    expect(isShenzhenCoordinate(22.5176, 113.9523)).toBe(true);
    expect(isShenzhenCoordinate(39.9042, 116.4074)).toBe(false);
  });

  it('uses inclusive Shenzhen bounds and rejects non-finite input', () => {
    expect(isShenzhenCoordinate(22.3, 113.7)).toBe(true);
    expect(isShenzhenCoordinate(22.9, 114.7)).toBe(true);
    expect(isShenzhenCoordinate(22.2999, 113.7)).toBe(false);
    expect(isShenzhenCoordinate(22.3, 114.7001)).toBe(false);
    expect(isShenzhenCoordinate(Number.NaN, 113.9)).toBe(false);
    expect(isShenzhenCoordinate(22.5, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('normalizes comma separated enums', () => {
    expect(splitCsv(' open , paused ,, ')).toEqual(['open', 'paused']);
    expect(splitCsv('')).toEqual([]);
    expect(splitCsv(' , , ')).toEqual([]);
    expect(splitCsv('open,,paused,')).toEqual(['open', 'paused']);
  });

  it('normalizes keywords by trimming and collapsing empty input', () => {
    expect(normalizeKeyword('  fishing spot  ')).toBe('fishing spot');
    expect(normalizeKeyword('')).toBe('');
    expect(normalizeKeyword('   ')).toBe('');
  });

  it('clamps keywords to 40 Unicode code points', () => {
    expect(normalizeKeyword('钓'.repeat(40))).toBe('钓'.repeat(40));
    expect(normalizeKeyword('钓'.repeat(45))).toBe('钓'.repeat(40));
    expect(normalizeKeyword('🐟'.repeat(45))).toBe('🐟'.repeat(40));
    expect(normalizeKeyword(`  ${'钓'.repeat(45)}  `)).toBe('钓'.repeat(40));
  });
});
