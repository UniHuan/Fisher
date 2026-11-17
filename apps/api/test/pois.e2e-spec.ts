import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ADMIN_ROLE } from '@szfisher/shared';
import request from 'supertest';
import {
  cleanupAdminSpotTestData,
  createPublishedSpot,
} from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import { POI_PROVIDER, type PoiProvider } from '../src/modules/pois/poi.provider';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  type AuthSession,
} from './support/auth-helpers';

jest.setTimeout(30000);

const POI_PREFIX = 'E2E-POI-';
const SYNC_PREFIX = 'e2e-sync-';
const spotIds: string[] = [];

type PublishedSpot = Awaited<ReturnType<typeof createPublishedSpot>>;

describe('POIs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let operator: AuthSession;
  let reviewer: AuthSession;
  let provider: PoiProvider;
  let publicSpot: PublishedSpot;
  let syncSpot: PublishedSpot;
  let manualPoiId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getAuthTestPrisma();
    operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    provider = app.get<PoiProvider>(POI_PROVIDER);
    publicSpot = await createPublishedSpot({
      spot_name: `${POI_PREFIX}公开钓点`,
    });
    syncSpot = await createPublishedSpot({
      spot_name: `${POI_PREFIX}同步钓点`,
    });
    spotIds.push(publicSpot.spot_id, syncSpot.spot_id);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.spotPoi.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.poiSyncRun.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.poi.deleteMany({
      where: {
        OR: [
          { source: 'manual', poi_name: { startsWith: POI_PREFIX } },
          { external_poi_id: { startsWith: SYNC_PREFIX } },
        ],
      },
    });
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  function adminPost(path: string, body?: Record<string, unknown>, session = operator) {
    const call = request(app.getHttpServer())
      .post(path)
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf);
    return body === undefined ? call : call.send(body);
  }

  function adminPut(path: string, body: Record<string, unknown>, session = operator) {
    return request(app.getHttpServer())
      .put(path)
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body);
  }

  function adminDelete(path: string, session = operator) {
    return request(app.getHttpServer())
      .delete(path)
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf);
  }

  it('creates a manual POI and lists it with filters and audit', async () => {
    const response = await adminPost('/api/v1/admin/pois', {
      poi_name: `${POI_PREFIX}停车场`,
      poi_type: 'parking',
      latitude: '22.518000',
      longitude: '113.953000',
      address: '深圳市南山区测试停车场',
      rating: '4.5',
      open_time: '全天',
    }).expect(201);
    const poi = response.body.data as Record<string, unknown>;
    manualPoiId = poi.poi_id as string;
    expect(poi).toMatchObject({
      poi_name: `${POI_PREFIX}停车场`,
      poi_type: 'parking',
      source: 'manual',
      status: 'active',
      latitude: '22.518000',
      longitude: '113.953000',
      rating: '4.5',
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/pois')
      .query({ poi_type: 'parking', keyword: 'E2E-POI', status: 'active' })
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);
    expect(
      (list.body.data.items as Array<Record<string, unknown>>).some(
        (item) => item.poi_id === manualPoiId,
      ),
    ).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { admin_id: operator.admin.adminId, action: 'poi.create', entity_id: manualPoiId },
    });
    expect(audit).not.toBeNull();

    const invalid = await adminPost('/api/v1/admin/pois', {
      poi_name: `${POI_PREFIX}越界`,
      poi_type: 'food',
      latitude: '39.904200',
      longitude: '116.407400',
    }).expect(400);
    expect(invalid.body.code).toBe(40001);
  });

  it('binds a POI, returns it from admin and public APIs, and audits the binding', async () => {
    const bound = await adminPost(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`, {
      poi_id: manualPoiId,
    }).expect(201);
    expect(bound.body.data).toMatchObject({
      poi_id: manualPoiId,
      effective_type: 'parking',
      distance_m: expect.any(Number),
    });
    const initialDistance = bound.body.data.distance_m as number;

    await adminPut(`/api/v1/admin/pois/${manualPoiId}`, {
      latitude: '22.600000',
      longitude: '114.000000',
    }).expect(200);
    const recalculated = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(recalculated.body.data.items[0].distance_m).toBeGreaterThan(initialDistance);

    await adminPut(`/api/v1/admin/pois/${manualPoiId}`, { status: null }).expect(400);

    const adminList = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(adminList.body.data.spot_id).toBe(publicSpot.spot_id);
    expect(adminList.body.data.items).toHaveLength(1);
    expect(adminList.body.data.last_sync).toBeNull();

    const publicList = await request(app.getHttpServer())
      .get(`/api/v1/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .expect(200);
    expect(publicList.body.data.items[0]).toMatchObject({
      poi_id: manualPoiId,
      poi_name: `${POI_PREFIX}停车场`,
      source_label: '运营录入',
    });

    const duplicate = await adminPost(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`, {
      poi_id: manualPoiId,
    }).expect(409);
    expect(duplicate.body.code).toBe(40901);

    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'poi.bind',
        entity_id: publicSpot.spot_id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('hides a POI from the public API but keeps it visible to admins', async () => {
    await adminPut(`/api/v1/admin/pois/${manualPoiId}`, { status: 'hidden' }).expect(200);

    const publicList = await request(app.getHttpServer())
      .get(`/api/v1/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .expect(200);
    expect(publicList.body.data.items).toHaveLength(0);

    const adminList = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(adminList.body.data.items[0]).toMatchObject({
      poi_id: manualPoiId,
      status: 'hidden',
    });
  });

  it('unbinds a POI and records the unlink', async () => {
    await adminDelete(
      `/api/v1/admin/spots/${publicSpot.spot_id}/pois/${manualPoiId}`,
    ).expect(200);

    const adminList = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${publicSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(adminList.body.data.items).toHaveLength(0);

    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'poi.unbind',
        entity_id: publicSpot.spot_id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('syncs provider POIs into bindings, preserves hidden status, and reports a failed run', async () => {
    const search = jest.spyOn(provider, 'searchNearby').mockResolvedValue({
      quotaUsed: 6,
      items: [
        {
          external_poi_id: `${SYNC_PREFIX}food`,
          poi_name: `${POI_PREFIX}同步餐厅`,
          poi_type: 'food',
          latitude: '22.517800',
          longitude: '113.952600',
          address: '同步测试地址',
          rating: null,
          open_time: null,
        },
        {
          external_poi_id: `${SYNC_PREFIX}parking`,
          poi_name: `${POI_PREFIX}同步停车场`,
          poi_type: 'parking',
          latitude: '22.520000',
          longitude: '113.956000',
          address: null,
          rating: null,
          open_time: null,
        },
      ],
    });

    const synced = await adminPost(`/api/v1/admin/spots/${syncSpot.spot_id}/pois/sync`)
      .expect(200);
    expect(synced.body.data).toMatchObject({
      spot_id: syncSpot.spot_id,
      status: 'success',
      poi_count: 2,
      quota_used: 6,
      error_message: null,
    });

    const adminList = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${syncSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(adminList.body.data.items).toHaveLength(2);
    expect(adminList.body.data.last_sync).toMatchObject({ status: 'success', poi_count: 2 });
    const parking = (adminList.body.data.items as Array<Record<string, unknown>>).find(
      (item) => item.poi_type === 'parking',
    );
    expect(parking?.distance_m).toBeGreaterThan(0);

    const publicList = await request(app.getHttpServer())
      .get(`/api/v1/spots/${syncSpot.spot_id}/pois`)
      .set(clientHeaders())
      .expect(200);
    expect(publicList.body.data.items).toHaveLength(2);
    expect(publicList.body.data.data_source).toContain('腾讯位置服务');

    const parkingId = parking?.poi_id as string;
    await adminPut(`/api/v1/admin/pois/${parkingId}`, { status: 'hidden' }).expect(200);
    await adminPost(`/api/v1/admin/spots/${syncSpot.spot_id}/pois/sync`).expect(200);
    const afterResync = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${syncSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(
      (afterResync.body.data.items as Array<Record<string, unknown>>).find(
        (item) => item.poi_id === parkingId,
      )?.status,
    ).toBe('hidden');

    search.mockRejectedValueOnce(new Error('quota temporarily exceeded'));
    const failed = await adminPost(`/api/v1/admin/spots/${syncSpot.spot_id}/pois/sync`)
      .expect(503);
    expect(failed.body.code).toBe(50301);

    const afterFailure = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${syncSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(afterFailure.body.data.last_sync).toMatchObject({
      status: 'failed',
      error_message: 'quota temporarily exceeded',
    });
    expect(afterFailure.body.data.items).toHaveLength(2);
  });

  it('recalculates stored distances when the spot coordinates change', async () => {
    const geoSpot = await createPublishedSpot({
      spot_name: `${POI_PREFIX}坐标变更钓点`,
      latitude: '22.517600',
      longitude: '113.952300',
    });
    spotIds.push(geoSpot.spot_id);
    const poiResponse = await adminPost('/api/v1/admin/pois', {
      poi_name: `${POI_PREFIX}坐标变更场所`,
      poi_type: 'food',
      latitude: '22.520000',
      longitude: '113.956000',
    }).expect(201);
    const geoPoiId = poiResponse.body.data.poi_id as string;
    const bound = await adminPost(`/api/v1/admin/spots/${geoSpot.spot_id}/pois`, {
      poi_id: geoPoiId,
    }).expect(201);
    const distanceBefore = bound.body.data.distance_m as number;

    await adminPut(`/api/v1/admin/spots/${geoSpot.spot_id}`, {
      latitude: '22.600000',
      longitude: '114.000000',
    }).expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${geoSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(after.body.data.items[0].distance_m).toBeGreaterThan(distanceBefore);
  });

  it('allows reviewer reads and blocks reviewer writes', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/spots/${syncSpot.spot_id}/pois`)
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(200);

    await adminPost(
      '/api/v1/admin/pois',
      {
        poi_name: `${POI_PREFIX}审核员越权`,
        poi_type: 'food',
        latitude: '22.517600',
        longitude: '113.952300',
      },
      reviewer,
    ).expect(403);
    await adminDelete(
      `/api/v1/admin/spots/${syncSpot.spot_id}/pois/${manualPoiId}`,
      reviewer,
    ).expect(403);
  });
});
