import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ulid } from 'ulid';
import {
  cleanupAdminSpotTestData,
  seedSpot,
} from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import { cleanupAuthTestData, getAuthTestPrisma } from './support/auth-helpers';

jest.setTimeout(30000);

const HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
} as const;

const OPEN_ID = ulid();
const PAUSED_ID = ulid();
const BANNED_ID = ulid();
const CORE_ID = ulid();
const DRAFT_ID = ulid();
const OFFLINE_ID = ulid();
const DELETED_ID = ulid();
const POI_ID = ulid();

describe('public spots (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;
  let imageKey: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = getAuthTestPrisma();
    imageKey = `spots/${OPEN_ID}/${ulid()}.webp`;

    await seedSpot({
      spot_id: OPEN_ID,
      spot_name: '深圳湾公园东门钓点',
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
      nav_latitude: '22.517600',
      nav_longitude: '113.952300',
      address: '深圳市南山区深圳湾公园东门',
      fish_types: ['luofei', 'jiyu'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'park',
      open_status: 'open',
      status: 'published',
      source: 'operation',
      verified_at: new Date(),
      sort_weight: 10,
      images: [imageKey],
      cover_image_key: imageKey,
    });
    await seedSpot({
      spot_id: PAUSED_ID,
      spot_name: '莲花山公园钓点',
      district: '福田区',
      latitude: '22.560000',
      longitude: '114.050000',
      fish_types: ['luofei'],
      fee_status: 'paid',
      water_type: 'lake',
      venue_type: 'park',
      open_status: 'paused',
      status: 'published',
      source: 'operation',
      verified_at: new Date(),
      sort_weight: 30,
    });
    await seedSpot({
      spot_id: BANNED_ID,
      spot_name: '禁钓测试水域',
      district: '罗湖区',
      latitude: '22.550000',
      longitude: '114.120000',
      fish_types: ['luofei'],
      fee_status: 'free',
      water_type: 'river',
      venue_type: 'wild',
      open_status: 'banned',
      ban_note: '官方公示禁钓',
      status: 'published',
      source: 'operation',
      verified_at: new Date(),
      sort_weight: 40,
    });
    await seedSpot({
      spot_id: CORE_ID,
      spot_name: '核心钓点',
      district: '南山区',
      latitude: '22.510000',
      longitude: '113.940000',
      fish_types: ['luofei'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      open_status: 'open',
      status: 'published',
      source: 'operation',
      verified_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      sort_weight: 50,
      is_core: true,
    });
    await seedSpot({
      spot_id: DRAFT_ID,
      spot_name: '公开列表草稿',
      open_status: 'open',
      status: 'draft',
    });
    await seedSpot({
      spot_id: OFFLINE_ID,
      spot_name: '公开列表下线',
      open_status: 'open',
      status: 'offline',
    });
    await seedSpot({
      spot_id: DELETED_ID,
      spot_name: '公开列表删除',
      open_status: 'open',
      status: 'published',
      deleted_at: new Date(),
    });

    await prisma.poi.create({
      data: {
        poi_id: POI_ID,
        poi_name: '附近停车场',
        poi_type: 'parking',
        latitude: '22.518000',
        longitude: '113.953000',
        address: '深圳湾公园停车场',
        rating: '4.6',
        source: 'tencent',
        status: 'active',
      },
    });
    await prisma.spotPoi.create({
      data: { spot_id: OPEN_ID, poi_id: POI_ID, distance_m: 120 },
    });
  });

  afterAll(async () => {
    await prisma.spotPoi.deleteMany({ where: { spot_id: OPEN_ID } });
    await prisma.poi.deleteMany({ where: { poi_id: POI_ID } });
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  it('lists only published open or paused spots by default', async () => {
    const response = await request(server)
      .get('/api/v1/spots')
      .set(HEADERS)
      .expect(200);
    const ids = response.body.data.items.map((item: { spot_id: string }) => item.spot_id);
    expect(ids).toEqual(expect.arrayContaining([OPEN_ID, PAUSED_ID, CORE_ID]));
    expect(ids).not.toContain(BANNED_ID);
    expect(ids).not.toContain(DRAFT_ID);
    expect(ids).not.toContain(OFFLINE_ID);
    expect(ids).not.toContain(DELETED_ID);
    expect(response.body.data.total).toBe(3);
  });

  it('supports include_banned, filters, keyword and pagination', async () => {
    const withBanned = await request(server)
      .get('/api/v1/spots')
      .query({ include_banned: true })
      .set(HEADERS)
      .expect(200);
    expect(
      withBanned.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === BANNED_ID,
      ),
    ).toBe(true);

    const filtered = await request(server)
      .get('/api/v1/spots')
      .query({ district: '南山区', fee_status: 'free', fish_types: 'luofei' })
      .set(HEADERS)
      .expect(200);
    expect(
      filtered.body.data.items.every(
        (item: { district: string; fee_status: string }) =>
          item.district === '南山区' && item.fee_status === 'free',
      ),
    ).toBe(true);

    const keyword = await request(server)
      .get('/api/v1/spots')
      .query({ keyword: '  深圳湾  ' })
      .set(HEADERS)
      .expect(200);
    expect(keyword.body.data.items).toHaveLength(1);
    expect(keyword.body.data.items[0].spot_id).toBe(OPEN_ID);

    const paged = await request(server)
      .get('/api/v1/spots')
      .query({ page: 1, page_size: 1, sort: 'recommended' })
      .set(HEADERS)
      .expect(200);
    expect(paged.body.data.page_size).toBe(1);
    expect(paged.body.data.has_more).toBe(true);
  });

  it('sorts by distance when coordinates are supplied', async () => {
    const response = await request(server)
      .get('/api/v1/spots')
      .query({ latitude: 22.5176, longitude: 113.9523 })
      .set(HEADERS)
      .expect(200);
    expect(response.body.data.items[0].spot_id).toBe(OPEN_ID);
    expect(response.body.data.items[0].distance_m).toBe(0);
  });

  it('rejects invalid distance and coordinate pairs', async () => {
    await request(server)
      .get('/api/v1/spots')
      .query({ sort: 'distance' })
      .set(HEADERS)
      .expect(400);
    await request(server)
      .get('/api/v1/spots')
      .query({ latitude: 22.5176 })
      .set(HEADERS)
      .expect(400);
    await request(server)
      .get('/api/v1/spots')
      .query({ open_status: 'unknown' })
      .set(HEADERS)
      .expect(400);
  });

  it('returns published detail with navigation, public images and POI summary', async () => {
    const response = await request(server)
      .get(`/api/v1/spots/${OPEN_ID}`)
      .set(HEADERS)
      .expect(200);
    const detail = response.body.data;
    expect(detail.spot_id).toBe(OPEN_ID);
    expect(detail.images).toEqual([
      expect.stringContaining(`/api/v1/uploads/public/${imageKey}`),
    ]);
    expect(detail.cover_image_url).toContain(`/api/v1/uploads/public/${imageKey}`);
    expect(detail.navigation).toMatchObject({
      latitude: '22.517600',
      longitude: '113.952300',
    });
    expect(detail.is_banned).toBe(false);
    expect(detail.poi_summary).toEqual([
      expect.objectContaining({ poi_type: 'parking', count: 1 }),
    ]);
  });

  it('allows banned detail by id but removes navigation', async () => {
    const response = await request(server)
      .get(`/api/v1/spots/${BANNED_ID}`)
      .set(HEADERS)
      .expect(200);
    expect(response.body.data.is_banned).toBe(true);
    expect(response.body.data.navigation).toBeNull();
    expect(response.body.data.ban_note).toBe('官方公示禁钓');
    expect(response.body.data.nav_latitude).toBeUndefined();

    for (const id of [DRAFT_ID, OFFLINE_ID, DELETED_ID, ulid()]) {
      await request(server).get(`/api/v1/spots/${id}`).set(HEADERS).expect(404);
    }
  });

  it('returns map points, bounds, clusters mode and cache headers', async () => {
    const response = await request(server)
      .get('/api/v1/spots/map')
      .set(HEADERS)
      .expect(200);
    expect(response.body.data.mode).toBe('points');
    expect(response.body.data.items.length).toBe(3);
    expect(response.headers['cache-control']).toBe('public, max-age=30');

    const bounded = await request(server)
      .get('/api/v1/spots/map')
      .query({
        north: 22.6,
        south: 22.5,
        east: 114.0,
        west: 113.9,
      })
      .set(HEADERS)
      .expect(200);
    expect(
      bounded.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === OPEN_ID,
      ),
    ).toBe(true);
    expect(
      bounded.body.data.items.some(
        (item: { spot_id: string }) => item.spot_id === BANNED_ID,
      ),
    ).toBe(false);

    await request(server)
      .get('/api/v1/spots/map')
      .query({ north: 22.6 })
      .set(HEADERS)
      .expect(400);
  });

  it('returns POIs by distance and filters by type with attribution', async () => {
    const response = await request(server)
      .get(`/api/v1/spots/${OPEN_ID}/pois`)
      .set(HEADERS)
      .expect(200);
    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        poi_id: POI_ID,
        poi_type: 'parking',
        distance_m: 120,
        source_label: '腾讯位置服务',
      }),
    ]);
    expect(response.body.data.data_source).toBe('腾讯位置服务');

    const empty = await request(server)
      .get(`/api/v1/spots/${OPEN_ID}/pois`)
      .query({ poi_type: 'food' })
      .set(HEADERS)
      .expect(200);
    expect(empty.body.data.items).toEqual([]);
  });

  it('returns grid clusters when the map exceeds 500 points', async () => {
    const prefix = '批量地图点';
    await prisma.spot.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        spot_id: ulid(),
        spot_name: `${prefix}${index}`,
        district: '南山区',
        latitude: '22.500000',
        longitude: '113.950000',
        open_status: 'open',
        status: 'published',
      })),
    });
    try {
      const response = await request(server)
        .get('/api/v1/spots/map')
        .query({ zoom: 12 })
        .set(HEADERS)
        .expect(200);
      expect(response.body.data.mode).toBe('clusters');
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.clusters.length).toBeGreaterThan(0);
      expect(response.body.data.total).toBeGreaterThan(500);
    } finally {
      await prisma.spot.deleteMany({ where: { spot_name: { startsWith: prefix } } });
    }
  });

  it('requires client context headers', async () => {
    const response = await request(server).get('/api/v1/spots').expect(400);
    expect(response.body.code).toBe(40001);
  });
});
