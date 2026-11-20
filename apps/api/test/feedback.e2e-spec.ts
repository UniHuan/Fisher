import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  ADMIN_ROLE,
  ERROR_CODES,
  FEEDBACK_CATEGORY,
  FEEDBACK_STATUS,
} from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import { permissionsForRole } from '../src/modules/auth/permissions';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { CONTENT_SECURITY_PROVIDER } from '../src/modules/content-security/content-security.types';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import {
  appAuthHeaders,
  appClientHeaders,
  cleanupAppAuthTestData,
  loginAppUser,
  resetAppLoginRateLimiter,
  type AppSession,
} from './support/app-auth-helpers';
import {
  cleanupAuthTestData,
  clientHeaders,
  loginAs,
  type AuthSession,
} from './support/auth-helpers';
import { FakeContentSecurityProvider } from './support/fake-content-security.provider';
import { FakeWechatAuthProvider } from './support/fake-wechat-auth.provider';

jest.setTimeout(120000);

const HEADERS = appClientHeaders();
const TEST_OPENIDS = [
  'openid-feedback-anon',
  'openid-feedback-flag',
  'openid-feedback-text',
  'openid-feedback-validation',
  'openid-feedback-owner',
  'openid-feedback-other',
  'openid-feedback-reuse',
  'openid-feedback-magic',
  'openid-feedback-large',
  'openid-feedback-upload-cap',
  'openid-feedback-create-cap',
  'openid-feedback-admin',
  'openid-feedback-page-one',
  'openid-feedback-page-two',
  'openid-feedback-page-three',
] as const;

const FEEDBACK_KEY_PATTERN = /^feedback\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;

interface UploadBody {
  key: string;
  width: number;
  height: number;
  size_bytes: number;
}

interface CreateFeedbackBody {
  feedback_id: string;
  status: string;
}

interface AdminFeedbackItem {
  feedback_id: string;
  category: string;
  content: string;
  status: string;
  user_nickname: string | null;
  spot_id: string | null;
  spot_name: string | null;
  image_count: number;
  created_at: string;
  handled_at: string | null;
}

interface AdminFeedbackDetail extends AdminFeedbackItem {
  contact: string | null;
  page: string | null;
  app_version: string | null;
  device_info: Record<string, string> | null;
  images: string[];
  note: string | null;
  handler_id: string | null;
  updated_at: string;
}

interface AdminFeedbackPage {
  items: AdminFeedbackItem[];
  next_cursor: string | null;
  total: number;
}

function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 180 } },
  })
    .png()
    .toBuffer();
}

function adminRequest(session: AuthSession): Record<string, string> {
  return {
    ...clientHeaders(),
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrf,
  };
}

function adminGet(session: AuthSession): Record<string, string> {
  return {
    ...clientHeaders(),
    Cookie: session.cookie,
  };
}

describe('Trial feedback API (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storageRoot: string;
  let spotId: string;

  async function setFeedbackFeature(enabled: boolean): Promise<void> {
    await prisma.config.upsert({
      where: { config_key: 'features.feedback' },
      create: {
        config_key: 'features.feedback',
        config_value: enabled ? 'true' : 'false',
        description: 'V1.1 体验反馈开关',
      },
      update: { config_value: enabled ? 'true' : 'false' },
    });
  }

  async function uploadImage(
    session: AppSession,
    buffer: Buffer,
    filename = 'shot.png',
    contentType = 'image/png',
  ): Promise<UploadBody> {
    const response = await request(server)
      .post('/api/v1/feedback/images')
      .set(appAuthHeaders(session.access_token))
      .attach('file', buffer, { filename, contentType })
      .expect(201);
    return response.body.data as UploadBody;
  }

  function createFeedback(
    session: AppSession,
    body: Record<string, unknown>,
  ): request.Test {
    return request(server)
      .post('/api/v1/feedback')
      .set(appAuthHeaders(session.access_token))
      .send(body);
  }

  async function cleanupFeedbackRows(openids: readonly string[]): Promise<void> {
    const identities = await prisma.userIdentity.findMany({
      where: { provider: 'wechat_mini', provider_uid: { in: [...openids] } },
      select: { user_id: true },
    });
    const userIds = [...new Set(identities.map((identity) => identity.user_id))];
    if (userIds.length === 0) {
      return;
    }
    // Feedback rows reference app users and admin handlers with RESTRICT FKs.
    await prisma.trialFeedback.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.feedbackImage.deleteMany({ where: { user_id: { in: userIds } } });
  }

  beforeAll(async () => {
    app = await createTestApp({
      wechatAuthProvider: {
        provide: WECHAT_AUTH_PROVIDER,
        useClass: FakeWechatAuthProvider,
      },
      contentSecurityProvider: {
        provide: CONTENT_SECURITY_PROVIDER,
        useClass: FakeContentSecurityProvider,
      },
    });
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storageRoot = process.env.STORAGE_LOCAL_ROOT as string;
    await cleanupFeedbackRows(TEST_OPENIDS);
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    const spot = await seedSpot({
      spot_name: `反馈测试钓点-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
    });
    spotId = spot.spot_id;
    await setFeedbackFeature(true);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
    await app.get(RateLimitService).reset('feedback:');
  });

  afterEach(async () => {
    await setFeedbackFeature(true);
  });

  afterAll(async () => {
    await cleanupFeedbackRows(TEST_OPENIDS);
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await cleanupAuthTestData();
    await cleanupAdminSpotTestData();
    await setFeedbackFeature(false);
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('requires the app bearer token on both C-end write routes', async () => {
    const upload = await request(server)
      .post('/api/v1/feedback/images')
      .set(HEADERS)
      .attach('file', await pngBuffer(), { filename: 'anon.png', contentType: 'image/png' })
      .expect(401);
    expect(upload.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    const create = await request(server)
      .post('/api/v1/feedback')
      .set(HEADERS)
      .send({ category: 'bug', content: '未登录也想提交反馈内容' })
      .expect(401);
    expect(create.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('returns FEATURE_DISABLED while the feedback flag is off and keeps admin reads working', async () => {
    const user = await loginAppUser(server, 'openid-feedback-flag');
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    await setFeedbackFeature(false);
    try {
      const upload = await request(server)
        .post('/api/v1/feedback/images')
        .set(appAuthHeaders(user.access_token))
        .attach('file', await pngBuffer(), { filename: 'closed.png', contentType: 'image/png' })
        .expect(403);
      expect(upload.body.code).toBe(ERROR_CODES.FEATURE_DISABLED);

      const create = await createFeedback(user, {
        category: FEEDBACK_CATEGORY.BUG,
        content: '开关关闭时不能提交反馈内容',
      }).expect(403);
      expect(create.body.code).toBe(ERROR_CODES.FEATURE_DISABLED);

      expect(await prisma.trialFeedback.count({ where: { user_id: user.user_id } })).toBe(0);
      expect(await prisma.feedbackImage.count({ where: { user_id: user.user_id } })).toBe(0);

      await request(server)
        .get('/api/v1/admin/feedback')
        .set(adminGet(reviewer))
        .expect(200);
    } finally {
      await setFeedbackFeature(true);
    }
  });

  it('creates a text feedback with page, spot, version and whitelisted device information', async () => {
    const user = await loginAppUser(server, 'openid-feedback-text');
    const deviceInfo = {
      model: 'iPhone 15 Pro',
      system: 'iOS 18.1',
      wechat_version: '8.0.54',
      sdk_version: '3.7.1',
    };
    const response = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.BUG,
      content: '  钓点详情页的收藏按钮点击后没有反应，麻烦看一下。  ',
      contact: 'wx_feedback_test',
      page: 'pages/detail/detail?spot_id=01HX0000000000000000000000',
      spot_id: spotId,
      app_version: '1.0.0',
      device_info: deviceInfo,
    }).expect(201);

    const body = response.body.data as CreateFeedbackBody;
    expect(body.feedback_id).toMatch(/^[A-Za-z0-9]{26}$/);
    expect(body.status).toBe(FEEDBACK_STATUS.OPEN);

    const row = await prisma.trialFeedback.findUniqueOrThrow({
      where: { feedback_id: body.feedback_id },
    });
    expect(row).toMatchObject({
      user_id: user.user_id,
      category: FEEDBACK_CATEGORY.BUG,
      content: '钓点详情页的收藏按钮点击后没有反应，麻烦看一下。',
      contact: 'wx_feedback_test',
      page: 'pages/detail/detail?spot_id=01HX0000000000000000000000',
      spot_id: spotId,
      app_version: '1.0.0',
      device_info: deviceInfo,
      image_keys: [],
      status: FEEDBACK_STATUS.OPEN,
      handler_id: null,
      handled_at: null,
    });
  });

  it('validates category, content code points, context lengths and the device_info whitelist', async () => {
    const user = await loginAppUser(server, 'openid-feedback-validation');

    const tooShort = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '只有九个字啊啊啊',
    }).expect(400);
    expect(tooShort.body.code).toBe(ERROR_CODES.VALIDATION);

    const tooLong = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '啊'.repeat(501),
    }).expect(400);
    expect(tooLong.body.code).toBe(ERROR_CODES.VALIDATION);

    const badCategory = await createFeedback(user, {
      category: 'spam',
      content: '类型不在允许的枚举范围之内',
    }).expect(400);
    expect(badCategory.body.code).toBe(ERROR_CODES.VALIDATION);

    const longContact = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '联系方式超出允许的最大长度',
      contact: '1'.repeat(81),
    }).expect(400);
    expect(longContact.body.code).toBe(ERROR_CODES.VALIDATION);

    const longPage = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '页面路径超出允许的最大长度',
      page: `/${'a'.repeat(120)}`,
    }).expect(400);
    expect(longPage.body.code).toBe(ERROR_CODES.VALIDATION);

    const extraDeviceKey = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '设备信息里不能夹带 openid 等字段',
      device_info: { model: 'iPhone', openid: 'should-not-be-stored' },
    }).expect(400);
    expect(extraDeviceKey.body.code).toBe(ERROR_CODES.VALIDATION);

    const tooManyImages = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '最多只能附带三张截图',
      image_keys: [1, 2, 3, 4].map(() => `feedback/${user.user_id}/${ulid()}.webp`),
    }).expect(400);
    expect(tooManyImages.body.code).toBe(ERROR_CODES.VALIDATION);

    await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '😀'.repeat(10),
    }).expect(201);

    await createFeedback(user, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '好'.repeat(500),
    }).expect(201);
  });

  it('uploads a private WebP, attaches it, and rejects reused or deleted keys', async () => {
    const user = await loginAppUser(server, 'openid-feedback-owner');
    const uploaded = await uploadImage(user, await pngBuffer());
    expect(uploaded.key).toMatch(FEEDBACK_KEY_PATTERN);
    expect(uploaded.key.startsWith(`feedback/${user.user_id}/`)).toBe(true);
    expect(uploaded.width).toBeLessThanOrEqual(1600);
    expect(uploaded.height).toBeLessThanOrEqual(1600);
    expect(uploaded.size_bytes).toBeLessThanOrEqual(300 * 1024);

    const row = await prisma.feedbackImage.findUniqueOrThrow({
      where: { object_key: uploaded.key },
    });
    expect(row).toMatchObject({
      user_id: user.user_id,
      status: 'pending',
      size_bytes: uploaded.size_bytes,
    });
    const path = join(storageRoot, 'working', ...uploaded.key.split('/'));
    expect(existsSync(path)).toBe(true);

    const created = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.PHOTO,
      content: '这是钓点的实拍照片，请审核后使用。',
      image_keys: [uploaded.key],
    }).expect(201);
    const feedbackId = (created.body.data as CreateFeedbackBody).feedback_id;
    const feedback = await prisma.trialFeedback.findUniqueOrThrow({
      where: { feedback_id: feedbackId },
    });
    expect(feedback.image_keys).toEqual([uploaded.key]);
    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { object_key: uploaded.key } }))
        .status,
    ).toBe('used');

    const reused = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.PHOTO,
      content: '重复使用同一张图片应当被拒绝',
      image_keys: [uploaded.key],
    }).expect(400);
    expect(reused.body.code).toBe(ERROR_CODES.VALIDATION);
    expect(await prisma.trialFeedback.count({ where: { user_id: user.user_id } })).toBe(1);

    const second = await uploadImage(user, await pngBuffer(16, 16));
    await prisma.feedbackImage.update({
      where: { object_key: second.key },
      data: { status: 'deleted', deleted_at: new Date() },
    });
    const deleted = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.PHOTO,
      content: '已经删除的图片不能再被引用',
      image_keys: [second.key],
    }).expect(400);
    expect(deleted.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it("rejects another user's pending image key and leaves it pending", async () => {
    const owner = await loginAppUser(server, 'openid-feedback-owner');
    const other = await loginAppUser(server, 'openid-feedback-other');
    const uploaded = await uploadImage(owner, await pngBuffer(16, 16));

    const rejected = await createFeedback(other, {
      category: FEEDBACK_CATEGORY.OTHER,
      content: '借用别人的图片 key 应当被拒绝',
      image_keys: [uploaded.key],
    }).expect(400);
    expect(rejected.body.code).toBe(ERROR_CODES.VALIDATION);
    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { object_key: uploaded.key } }))
        .status,
    ).toBe('pending');
  });

  it('accepts JPEG, PNG and WebP magic bytes and rejects disguised files over 5 MB', async () => {
    const user = await loginAppUser(server, 'openid-feedback-magic');
    const jpeg = await sharp({
      create: { width: 24, height: 18, channels: 3, background: { r: 180, g: 80, b: 20 } },
    })
      .jpeg()
      .toBuffer();
    const webp = await sharp({
      create: { width: 24, height: 18, channels: 3, background: { r: 20, g: 180, b: 80 } },
    })
      .webp()
      .toBuffer();
    for (const [buffer, filename, contentType] of [
      [jpeg, 'shot.jpg', 'image/jpeg'],
      [await pngBuffer(24, 18), 'shot.png', 'image/png'],
      [webp, 'shot.webp', 'image/webp'],
    ] as const) {
      const uploaded = await uploadImage(user, buffer, filename, contentType);
      expect(uploaded.key).toMatch(FEEDBACK_KEY_PATTERN);
    }

    const fake = await request(server)
      .post('/api/v1/feedback/images')
      .set(appAuthHeaders(user.access_token))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(fake.body.code).toBe(ERROR_CODES.VALIDATION);

    const hugeUser = await loginAppUser(server, 'openid-feedback-large');
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const large = await request(server)
      .post('/api/v1/feedback/images')
      .set(appAuthHeaders(hugeUser.access_token))
      .attach('file', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' })
      .expect(413);
    expect(large.body.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(await prisma.feedbackImage.count({ where: { user_id: hugeUser.user_id } })).toBe(0);
  });

  it('enforces the 10 images per user per day quota', async () => {
    const user = await loginAppUser(server, 'openid-feedback-upload-cap');
    const tiny = await pngBuffer(8, 8);
    for (let index = 0; index < 10; index += 1) {
      await uploadImage(user, tiny);
    }

    const blocked = await request(server)
      .post('/api/v1/feedback/images')
      .set(appAuthHeaders(user.access_token))
      .attach('file', tiny, { filename: 'extra.png', contentType: 'image/png' })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(await prisma.feedbackImage.count({ where: { user_id: user.user_id } })).toBe(10);
  });

  it('enforces the 5 feedbacks per user per day quota', async () => {
    const user = await loginAppUser(server, 'openid-feedback-create-cap');
    for (let index = 0; index < 5; index += 1) {
      await createFeedback(user, {
        category: FEEDBACK_CATEGORY.SUGGESTION,
        content: `第 ${index + 1} 条体验建议内容`,
      }).expect(201);
    }

    const blocked = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.SUGGESTION,
      content: '第六条反馈应当被每日限额拦截',
    }).expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(await prisma.trialFeedback.count({ where: { user_id: user.user_id } })).toBe(5);
  });

  it('lets an admin list, read and handle feedback without exposing openids', async () => {
    const user = await loginAppUser(server, 'openid-feedback-admin');
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const uploaded = await uploadImage(user, await pngBuffer(40, 30));
    const created = await createFeedback(user, {
      category: FEEDBACK_CATEGORY.BUG,
      content: '后台可以看到页面、机型和截图上下文。',
      contact: 'wx_admin_contact',
      page: 'pages/index/index',
      spot_id: spotId,
      app_version: '1.0.0',
      device_info: { model: 'Pixel 9', system: 'Android 15' },
      image_keys: [uploaded.key],
    }).expect(201);
    const feedbackId = (created.body.data as CreateFeedbackBody).feedback_id;

    const listResponse = await request(server)
      .get('/api/v1/admin/feedback')
      .query({ status: FEEDBACK_STATUS.OPEN, category: FEEDBACK_CATEGORY.BUG, limit: 20 })
      .set(adminGet(reviewer))
      .expect(200);
    const list = listResponse.body.data as AdminFeedbackPage;
    expect(JSON.stringify(list)).not.toContain('openid-feedback-admin');
    const item = list.items.find((row) => row.feedback_id === feedbackId);
    expect(item).toMatchObject({
      category: FEEDBACK_CATEGORY.BUG,
      status: FEEDBACK_STATUS.OPEN,
      user_nickname: expect.any(String),
      spot_id: spotId,
      image_count: 1,
    });
    expect(item?.spot_name).toBeTruthy();

    const filteredOut = await request(server)
      .get('/api/v1/admin/feedback')
      .query({ category: FEEDBACK_CATEGORY.SUGGESTION, limit: 50 })
      .set(adminGet(reviewer))
      .expect(200);
    expect(
      (filteredOut.body.data as AdminFeedbackPage).items.some(
        (row) => row.feedback_id === feedbackId,
      ),
    ).toBe(false);

    const badLimit = await request(server)
      .get('/api/v1/admin/feedback')
      .query({ limit: 51 })
      .set(adminGet(reviewer))
      .expect(400);
    expect(badLimit.body.code).toBe(ERROR_CODES.VALIDATION);

    const detailResponse = await request(server)
      .get(`/api/v1/admin/feedback/${feedbackId}`)
      .set(adminGet(reviewer))
      .expect(200);
    const detail = detailResponse.body.data as AdminFeedbackDetail;
    expect(JSON.stringify(detail)).not.toContain('openid-feedback-admin');
    expect(detail).toMatchObject({
      feedback_id: feedbackId,
      contact: 'wx_admin_contact',
      page: 'pages/index/index',
      app_version: '1.0.0',
      device_info: { model: 'Pixel 9', system: 'Android 15' },
      note: null,
      handler_id: null,
    });
    expect(detail.user_nickname).toBe(item?.user_nickname);
    expect(detail.images).toHaveLength(1);
    expect(detail.images[0]).toContain('/api/v1/uploads/preview?');

    const preview = await request(server).get(detail.images[0] as string).expect(200);
    expect(preview.headers['content-type']).toContain('image/webp');

    const tampered = (detail.images[0] as string).replace(/signature=[^&]+/, 'signature=invalid');
    const tamperedResponse = await request(server).get(tampered).expect(404);
    expect(tamperedResponse.body.code).toBe(ERROR_CODES.NOT_FOUND);

    const updated = await request(server)
      .patch(`/api/v1/admin/feedback/${feedbackId}`)
      .set(adminRequest(reviewer))
      .send({ status: FEEDBACK_STATUS.REVIEWING, note: '已复现，安排修复' })
      .expect(200);
    expect(updated.body.data).toEqual({
      feedback_id: feedbackId,
      status: FEEDBACK_STATUS.REVIEWING,
    });
    const handled = await prisma.trialFeedback.findUniqueOrThrow({
      where: { feedback_id: feedbackId },
    });
    expect(handled.status).toBe(FEEDBACK_STATUS.REVIEWING);
    expect(handled.note).toBe('已复现，安排修复');
    expect(handled.handler_id).toBe(reviewer.admin.adminId);
    expect(handled.handled_at).not.toBeNull();

    const badStatus = await request(server)
      .patch(`/api/v1/admin/feedback/${feedbackId}`)
      .set(adminRequest(reviewer))
      .send({ status: 'done' })
      .expect(400);
    expect(badStatus.body.code).toBe(ERROR_CODES.VALIDATION);

    const longNote = await request(server)
      .patch(`/api/v1/admin/feedback/${feedbackId}`)
      .set(adminRequest(reviewer))
      .send({ note: '好'.repeat(501) })
      .expect(400);
    expect(longNote.body.code).toBe(ERROR_CODES.VALIDATION);

    const unknown = await request(server)
      .get(`/api/v1/admin/feedback/${ulid()}`)
      .set(adminGet(reviewer))
      .expect(404);
    expect(unknown.body.code).toBe(ERROR_CODES.NOT_FOUND);

    const unknownPatch = await request(server)
      .patch(`/api/v1/admin/feedback/${ulid()}`)
      .set(adminRequest(reviewer))
      .send({ status: FEEDBACK_STATUS.CLOSED })
      .expect(404);
    expect(unknownPatch.body.code).toBe(ERROR_CODES.NOT_FOUND);

    const anonymous = await request(server)
      .get('/api/v1/admin/feedback')
      .set(clientHeaders())
      .expect(401);
    expect(anonymous.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('pages admin feedback by created_at DESC, feedback_id DESC', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const created: string[] = [];
    for (const openid of [
      'openid-feedback-page-one',
      'openid-feedback-page-two',
      'openid-feedback-page-three',
    ]) {
      const user = await loginAppUser(server, openid);
      const response = await createFeedback(user, {
        category: FEEDBACK_CATEGORY.CONTENT,
        content: `内容纠错分页测试 ${created.length + 1}`,
      }).expect(201);
      created.push((response.body.data as CreateFeedbackBody).feedback_id);
    }

    const first = await request(server)
      .get('/api/v1/admin/feedback')
      .query({ category: FEEDBACK_CATEGORY.CONTENT, limit: 2 })
      .set(adminGet(reviewer))
      .expect(200);
    const firstPage = first.body.data as AdminFeedbackPage;
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items.map((row) => row.feedback_id)).toEqual([created[2], created[1]]);
    expect(firstPage.total).toBe(3);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const second = await request(server)
      .get('/api/v1/admin/feedback')
      .query({
        category: FEEDBACK_CATEGORY.CONTENT,
        limit: 2,
        cursor: firstPage.next_cursor as string,
      })
      .set(adminGet(reviewer))
      .expect(200);
    const secondPage = second.body.data as AdminFeedbackPage;
    expect(secondPage.items.map((row) => row.feedback_id)).toEqual([created[0]]);
    expect(secondPage.next_cursor).toBeNull();

    const invalidCursor = await request(server)
      .get('/api/v1/admin/feedback')
      .query({ cursor: 'not-a-cursor' })
      .set(adminGet(reviewer))
      .expect(400);
    expect(invalidCursor.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('grants feedback read and handle permissions to all three admin roles', () => {
    for (const role of [ADMIN_ROLE.SUPER_ADMIN, ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER]) {
      expect(permissionsForRole(role)).toEqual(
        expect.arrayContaining(['feedback:read', 'feedback:handle']),
      );
    }
  });
});
