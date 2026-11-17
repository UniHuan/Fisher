import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ADMIN_ROLE } from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import { AdminSpotsRepository } from '../src/modules/admin-spots/admin-spots.repository';
import { createTestApp } from './create-test-app';
import {
  cleanupAdminSpotTestData,
  createCompleteDraft,
  createDraft,
  createPublishedSpot,
  createVerifiedCompleteDraft,
  markVerifiedInDb,
  seedSpot,
  trackSpotId,
} from './admin-spots.helpers';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  loginAsSuperAdmin,
} from './support/auth-helpers';

jest.setTimeout(30000);

const DRAFT_ID = ulid();
const PUBLISHED_ID = ulid();
const OFFLINE_ID = ulid();
const DELETED_ID = ulid();

describe('admin spots (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = getAuthTestPrisma();

    await seedSpot({
      spot_id: DRAFT_ID,
      spot_name: '深圳湾草稿钓点',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
      status: 'draft',
    });
    await seedSpot({
      spot_id: PUBLISHED_ID,
      spot_name: '已发布钓点',
      status: 'published',
    });
    await seedSpot({
      spot_id: OFFLINE_ID,
      spot_name: '已下线钓点',
      status: 'offline',
    });
    await seedSpot({
      spot_id: DELETED_ID,
      spot_name: '已删除钓点',
      status: 'draft',
      deleted_at: new Date(),
    });
  });

  afterAll(async () => {
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  it('lists drafts, published and offline spots for admin readers', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .get('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);

    expect(
      response.body.data.items.map((item: { spot_id: string }) => item.spot_id),
    ).toEqual(expect.arrayContaining([DRAFT_ID, PUBLISHED_ID, OFFLINE_ID]));
    expect(
      response.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === DELETED_ID,
      ),
    ).toBe(false);
  });

  it('filters by status, district, normalized name and pagination', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .get('/api/v1/admin/spots')
      .query({
        status: 'draft',
        district: '南山区',
        keyword: '  深圳湾  ',
        page: 1,
        page_size: 10,
      })
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(
      response.body.data.items.every((item: { status: string }) => item.status === 'draft'),
    ).toBe(true);
    expect(
      response.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === DRAFT_ID,
      ),
    ).toBe(true);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.page_size).toBe(10);

    const recent = await request(server)
      .get('/api/v1/admin/spots')
      .query({
        status: 'draft',
        updated_from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(
      recent.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === DRAFT_ID,
      ),
    ).toBe(true);

    const stale = await request(server)
      .get('/api/v1/admin/spots')
      .query({ updated_to: '2000-01-01T00:00:00.000Z' })
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(stale.body.data.items).toEqual([]);
  });

  it('returns detail for drafts and rejects deleted ids', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const detail = await request(server)
      .get(`/api/v1/admin/spots/${DRAFT_ID}`)
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(detail.body.data.spot_id).toBe(DRAFT_ID);
    expect(detail.body.data.latitude).toBe('22.517600');

    const deleted = await request(server)
      .get(`/api/v1/admin/spots/${DELETED_ID}`)
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(404);
    expect(deleted.body.code).toBe(40401);
  });

  it('requires authentication and allows reviewer reads only', async () => {
    await request(server).get('/api/v1/admin/spots').set(clientHeaders()).expect(401);
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    await request(server)
      .get('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(200);
  });

  it('creates a draft with only spot_name and fills safe defaults', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ spot_name: '深圳湾测试钓点' })
      .expect(201);

    const spot = response.body.data.spot;
    trackSpotId(spot.spot_id);
    expect(spot).toMatchObject({
      spot_name: '深圳湾测试钓点',
      status: 'draft',
      source: 'operation',
      city_code: '440300',
      is_core: false,
      sort_weight: 0,
      fish_types: [],
      images: [],
      cover_image_key: null,
    });
    expect(response.body.data.warnings).toEqual([]);
    const row = await prisma.spot.findUniqueOrThrow({
      where: { spot_id: spot.spot_id },
    });
    expect(row.status).toBe('draft');
  });

  it('rejects out-of-range coordinates and unknown dictionary values', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const outOfRange = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ spot_name: '越界', latitude: '23.000000', longitude: '114.000000' })
      .expect(400);
    expect(outOfRange.body.code).toBe(40001);

    const badDictionary = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({
        spot_name: '字典错误',
        district: '不存在区',
        fish_types: ['not_a_fish'],
      })
      .expect(400);
    expect(badDictionary.body.code).toBe(40001);
  });

  it('maps a database CHECK violation from a newly enabled district to 40001', async () => {
    const district = '深汕特别合作区';
    await prisma.dictionary.deleteMany({
      where: { dict_type: 'district', dict_key: district },
    });
    await prisma.dictionary.create({
      data: {
        dict_type: 'district',
        dict_key: district,
        dict_label: district,
        sort_order: 999,
        enabled: true,
      },
    });
    try {
      const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
      const response = await request(server)
        .post('/api/v1/admin/spots')
        .set(clientHeaders())
        .set('Cookie', operator.cookie)
        .set('X-CSRF-Token', operator.csrf)
        .send({ spot_name: '数据库约束', district })
        .expect(400);
      expect(response.body.code).toBe(40001);
    } finally {
      await prisma.dictionary.deleteMany({
        where: { dict_type: 'district', dict_key: district },
      });
    }
  });

  it('returns duplicate warnings without blocking the create', async () => {
    await seedSpot({
      spot_name: '深圳湾公园钓点',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
    });
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({
        spot_name: '深圳湾公园钓鱼点',
        district: '南山区',
        latitude: '22.517700',
        longitude: '113.952400',
      })
      .expect(201);
    trackSpotId(response.body.data.spot.spot_id);
    expect(response.body.data.warnings).toEqual([
      expect.objectContaining({
        spot_id: expect.any(String),
        distance_m: expect.any(Number),
      }),
    ]);
  });

  it('warns for a duplicate just under 200 metres', async () => {
    await seedSpot({
      spot_name: '边界重复钓点',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
    });
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({
        spot_name: '边界重复钓点测试',
        district: '南山区',
        latitude: '22.519395',
        longitude: '113.952300',
      })
      .expect(201);
    trackSpotId(response.body.data.spot.spot_id);
    expect(response.body.data.warnings).toEqual([
      expect.objectContaining({
        spot_id: expect.any(String),
        distance_m: expect.any(Number),
      }),
    ]);
  });

  it('defaults a missing cover to the first image and rejects a cover outside images', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const defaulted = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ spot_name: '封面默认', images: ['cover-a.jpg', 'cover-b.jpg'] })
      .expect(201);
    trackSpotId(defaulted.body.data.spot.spot_id);
    expect(defaulted.body.data.spot.cover_image_key).toBe('cover-a.jpg');

    const bad = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({
        spot_name: '封面越界',
        images: ['cover-a.jpg'],
        cover_image_key: 'cover-x.jpg',
      })
      .expect(400);
    expect(bad.body.code).toBe(40001);
  });

  it('writes a spot.create audit row and blocks reviewer writes', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ spot_name: '审计钓点' })
      .expect(201);
    trackSpotId(response.body.data.spot.spot_id);
    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.create',
        entity_id: response.body.data.spot.spot_id,
      },
    });
    expect(audit).not.toBeNull();

    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    await request(server)
      .post('/api/v1/admin/spots')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .set('X-CSRF-Token', reviewer.csrf)
      .send({ spot_name: '审核员不能写' })
      .expect(403);
  });

  it('lets a draft clear optional fields and defaults navigation', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const created = await createDraft(app, operator, {
      spot_name: '可清空草稿',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
      address: '旧地址',
      fish_types: ['luofei'],
    });
    const response = await request(server)
      .put(`/api/v1/admin/spots/${created.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ address: null, fish_types: [] })
      .expect(200);
    expect(response.body.data.spot.address).toBeNull();
    expect(response.body.data.spot.fish_types).toEqual([]);
    expect(response.body.data.spot.nav_latitude).toBe('22.517600');
    expect(response.body.data.spot.nav_longitude).toBe('113.952300');
  });

  it('defaults an explicit null nav pair from spot coordinates on update', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, {
      spot_name: '导航回退',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
    });
    const response = await request(server)
      .put(`/api/v1/admin/spots/${draft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ nav_latitude: null, nav_longitude: null })
      .expect(200);
    expect(response.body.data.spot.nav_latitude).toBe('22.517600');
    expect(response.body.data.spot.nav_longitude).toBe('113.952300');
  });

  it('falls back to the first image when the cover is removed', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, {
      spot_name: '封面回退',
      images: ['cover-a.jpg', 'cover-b.jpg'],
      cover_image_key: 'cover-a.jpg',
    });
    const response = await request(server)
      .put(`/api/v1/admin/spots/${draft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ images: ['cover-b.jpg'] })
      .expect(200);
    expect(response.body.data.spot.cover_image_key).toBe('cover-b.jpg');
  });

  it('does not let a published spot clear required fields', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const published = await createPublishedSpot();
    const response = await request(server)
      .put(`/api/v1/admin/spots/${published.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ district: null })
      .expect(422);
    expect(response.body.code).toBe(42201);
    expect(response.body.details).toEqual([
      expect.objectContaining({ field: 'district' }),
    ]);
  });

  it('updates other published fields and writes before/after audit', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const published = await createPublishedSpot();
    const response = await request(server)
      .put(`/api/v1/admin/spots/${published.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ description: '新的钓位说明' })
      .expect(200);
    expect(response.body.data.spot.description).toBe('新的钓位说明');
    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.update',
        entity_id: published.spot_id,
      },
      orderBy: { created_at: 'desc' },
    });
    expect(audit?.before_json).toBeTruthy();
    expect(audit?.after_json).toBeTruthy();
  });

  it('returns duplicate warnings on update without blocking', async () => {
    await seedSpot({
      spot_name: '更新重名候选A',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
    });
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, {
      spot_name: '更新重名候选B',
      district: '南山区',
      latitude: '22.517700',
      longitude: '113.952400',
    });
    const response = await request(server)
      .put(`/api/v1/admin/spots/${draft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ description: '触发更新重复告警' })
      .expect(200);
    expect(response.body.data.warnings).toEqual([
      expect.objectContaining({
        spot_id: expect.any(String),
        distance_m: expect.any(Number),
      }),
    ]);
  });

  it('rejects publish when required fields are missing, with field details', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, { spot_name: '缺字段草稿' });
    const response = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(422);
    expect(response.body.code).toBe(42201);
    expect(
      response.body.details.map((issue: { field: string }) => issue.field),
    ).toEqual(
      expect.arrayContaining([
        'district',
        'latitude',
        'longitude',
        'address',
        'fish_types',
        'verified_at',
      ]),
    );
  });

  it('publishes a complete verified spot, then refuses a repeated publish', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createCompleteDraft(app, operator);
    await markVerifiedInDb(draft.spot_id);
    const published = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(200);
    expect(published.body.data.status).toBe('published');

    await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(409);
  });

  it('offlines a published spot idempotently and rejects offline from draft', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, { spot_name: '未发布下线' });
    await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/offline`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(409);

    const published = await createPublishedSpot();
    const key = 'offline-idem-1';
    const first = await request(server)
      .post(`/api/v1/admin/spots/${published.spot_id}/offline`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(first.body.data.status).toBe('offline');

    const replay = await request(server)
      .post(`/api/v1/admin/spots/${published.spot_id}/offline`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    const audits = await prisma.auditLog.count({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.offline',
        entity_id: published.spot_id,
      },
    });
    expect(audits).toBe(1);

    const republished = await request(server)
      .post(`/api/v1/admin/spots/${published.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(200);
    expect(republished.body.data.status).toBe('published');
  });

  it('replays an idempotent publish without a second audit row', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createVerifiedCompleteDraft(app, operator);
    const key = 'publish-idem-1';
    const first = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);
    const replay = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    const audits = await prisma.auditLog.count({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.publish',
        entity_id: draft.spot_id,
      },
    });
    expect(audits).toBe(1);
  });

  it('returns 40902 for the same key with a different request scope', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const first = await createVerifiedCompleteDraft(app, operator, {
      spot_name: '幂等甲',
    });
    const second = await createVerifiedCompleteDraft(app, operator, {
      spot_name: '幂等乙',
    });
    const key = 'publish-idem-different';
    await request(server)
      .post(`/api/v1/admin/spots/${first.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);

    const conflict = await request(server)
      .post(`/api/v1/admin/spots/${second.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(409);
    expect(conflict.body.code).toBe(40902);
  });

  it('treats an expired idempotency key as a new request', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createVerifiedCompleteDraft(app, operator);
    const key = 'expired-publish-key';
    await prisma.idempotencyKey.create({
      data: {
        actor_type: 'admin',
        actor_id: operator.admin.adminId,
        key,
        request_hash: 'stale',
        expires_at: new Date(Date.now() - 1000),
      },
    });
    const response = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(response.body.data.status).toBe('published');
    const stored = await prisma.idempotencyKey.findUnique({
      where: {
        actor_type_actor_id_key: {
          actor_type: 'admin',
          actor_id: operator.admin.adminId,
          key,
        },
      },
    });
    expect(stored?.response_json).not.toBeNull();
    expect(stored?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an oversized idempotency key before publishing', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createVerifiedCompleteDraft(app, operator);
    const response = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', 'x'.repeat(129))
      .expect(400);
    expect(response.body.code).toBe(40001);
    const row = await prisma.spot.findUniqueOrThrow({
      where: { spot_id: draft.spot_id },
    });
    expect(row.status).toBe('draft');
  });

  it('returns 40902 while an idempotency reservation is in progress', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createVerifiedCompleteDraft(app, operator);
    const key = 'in-progress-publish-key';
    const requestHash = createHash('sha256')
      .update(`spot.publish:${draft.spot_id}\nnull`)
      .digest('hex');
    await prisma.idempotencyKey.create({
      data: {
        actor_type: 'admin',
        actor_id: operator.admin.adminId,
        key,
        request_hash: requestHash,
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    const response = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Idempotency-Key', key)
      .expect(409);
    expect(response.body.code).toBe(40902);
    const row = await prisma.spot.findUniqueOrThrow({
      where: { spot_id: draft.spot_id },
    });
    expect(row.status).toBe('draft');
  });

  it('rejects stale optimistic updates and state transitions', async () => {
    const repository = app.get(AdminSpotsRepository, { strict: false });
    const row = await seedSpot({ spot_name: '并发保护', status: 'draft' });
    const stale = new Date(0);
    expect(await repository.update(row.spot_id, { description: 'stale' }, stale)).toBe(0);
    expect(
      await repository.transitionStatus(row.spot_id, ['draft'], 'published', stale),
    ).toBe(0);
    expect(await repository.softDelete(row.spot_id, ['draft'], stale)).toBe(0);
  });

  it('rejects publish for a banned spot without ban_note and a core spot without images', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const banned = await createCompleteDraft(app, operator, {
      spot_name: '禁钓无备注',
      open_status: 'banned',
      ban_note: null,
    });
    await markVerifiedInDb(banned.spot_id);
    const bannedResponse = await request(server)
      .post(`/api/v1/admin/spots/${banned.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(422);
    expect(bannedResponse.body.code).toBe(42201);
    expect(
      bannedResponse.body.details.map((issue: { field: string }) => issue.field),
    ).toContain('ban_note');

    const core = await createCompleteDraft(app, operator, {
      spot_name: '核心无图',
      is_core: true,
      images: [],
    });
    await markVerifiedInDb(core.spot_id);
    const coreResponse = await request(server)
      .post(`/api/v1/admin/spots/${core.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(422);
    expect(coreResponse.body.code).toBe(42201);
    expect(
      coreResponse.body.details.map((issue: { field: string }) => issue.field),
    ).toContain('images');
  });

  it('soft-deletes draft spots but not published spots, and only super admin may delete', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const draft = await createDraft(app, superAdmin, { spot_name: '待删除草稿' });
    await request(server)
      .delete(`/api/v1/admin/spots/${draft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .expect(200);
    const row = await prisma.spot.findUniqueOrThrow({
      where: { spot_id: draft.spot_id },
    });
    expect(row.deleted_at).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: superAdmin.admin.adminId,
        action: 'spot.delete',
        entity_id: draft.spot_id,
      },
    });
    expect(audit).not.toBeNull();

    const offline = await seedSpot({ spot_name: '待删除下线', status: 'offline' });
    await request(server)
      .delete(`/api/v1/admin/spots/${offline.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .expect(200);
    const offlineRow = await prisma.spot.findUniqueOrThrow({
      where: { spot_id: offline.spot_id },
    });
    expect(offlineRow.deleted_at).not.toBeNull();

    const published = await createPublishedSpot();
    await request(server)
      .delete(`/api/v1/admin/spots/${published.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .expect(409);

    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const operatorDraft = await createDraft(app, operator, { spot_name: '运营不能删' });
    await request(server)
      .delete(`/api/v1/admin/spots/${operatorDraft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(403);
  });

  it('marks a spot verified and records method and note in audit', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createDraft(app, operator, { spot_name: '待核实草稿' });
    const before = Date.now();
    const response = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/verify`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ method: '现场', note: '水情稳定' })
      .expect(200);
    expect(new Date(response.body.data.verified_at).getTime()).toBeGreaterThanOrEqual(before);
    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.verify',
        entity_id: draft.spot_id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.after_json).toMatchObject({ method: '现场', note: '水情稳定' });
  });

  it('rejects reviewer verify writes', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    await request(server)
      .post(`/api/v1/admin/spots/${DRAFT_ID}/verify`)
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .set('X-CSRF-Token', reviewer.csrf)
      .expect(403);
  });
});
