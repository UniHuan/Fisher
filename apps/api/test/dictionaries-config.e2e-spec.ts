import type { INestApplication } from '@nestjs/common';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import type { paths } from '../../../packages/api-client/src/schema';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  loginAsSuperAdmin,
} from './support/auth-helpers';

type PublicDictionariesResponse =
  paths['/api/v1/dictionaries']['get']['responses'][200]['content']['application/json'];
type ClientConfigResponse =
  paths['/api/v1/config']['get']['responses'][200]['content']['application/json'];

jest.setTimeout(30000);

const PUBLIC_HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
} as const;

const DICTIONARY_GROUPS = [
  'districts',
  'fee_status',
  'fish_types',
  'fishing_methods',
  'poi_types',
  'venue_types',
  'water_types',
] as const;

interface DictionaryItem {
  key: string;
  label: string;
  sort_order: number;
}

interface MetricDictionaryItem extends DictionaryItem {
  dict_type: string;
  dict_key: string;
  dict_label: string;
  enabled: boolean;
  parent_key: string | null;
}

function uniqueKey(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${ulid().slice(-6)}`;
}

function assertSorted(items: DictionaryItem[]): void {
  const sorted = [...items].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
  expect(items).toEqual(sorted);
}

describe('dictionaries and client config (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const createdDictionaryKeys: Array<{ dict_type: string; dict_key: string }> = [];
  const createdConfigKeys: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    const prisma = getAuthTestPrisma();
    if (createdDictionaryKeys.length > 0) {
      await prisma.dictionary.deleteMany({
        where: { OR: createdDictionaryKeys.map((key) => ({ ...key })) },
      });
    }
    if (createdConfigKeys.length > 0) {
      await prisma.config.deleteMany({ where: { config_key: { in: createdConfigKeys } } });
    }
    await cleanupAuthTestData();
    await app.close();
  });

  async function createDictionaryRow(input: {
    dict_type: string;
    dict_key: string;
    dict_label: string;
    sort_order: number;
    enabled: boolean;
    parent_key?: string | null;
  }): Promise<void> {
    await getAuthTestPrisma().dictionary.create({ data: input });
    createdDictionaryKeys.push({ dict_type: input.dict_type, dict_key: input.dict_key });
  }

  function publicGetDictionaries(): request.Test {
    return request(server).get('/api/v1/dictionaries').set(PUBLIC_HEADERS);
  }

  it('returns ten districts and an etag, then 304 on If-None-Match', async () => {
    const first = await publicGetDictionaries().expect(200);

    expect(first.body.code).toBe(ERROR_CODES.SUCCESS);
    expect(first.body.data.districts).toHaveLength(10);
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers['cache-control']).toBe('public, max-age=600');

    const second = await publicGetDictionaries()
      .set('If-None-Match', first.headers.etag as string)
      .expect(304);

    expect(second.text).toBe('');
    expect(second.headers.etag).toBe(first.headers.etag);
  });

  it('returns all seven groups with enabled, sorted {key,label,sort_order} items', async () => {
    const disabledKey = uniqueKey('test_d7_disabled');
    await createDictionaryRow({
      dict_type: 'poi_type',
      dict_key: disabledKey,
      dict_label: '已禁用类型',
      sort_order: 999,
      enabled: false,
    });

    const res = await publicGetDictionaries().expect(200);
    const data = res.body.data as Record<string, DictionaryItem[]>;

    expect(Object.keys(data).sort()).toEqual([...DICTIONARY_GROUPS]);
    expect(data).not.toHaveProperty('fee_units');

    for (const group of DICTIONARY_GROUPS) {
      const items = data[group] as DictionaryItem[];
      expect(Array.isArray(items)).toBe(true);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['key', 'label', 'sort_order']);
        expect(typeof item.key).toBe('string');
        expect(typeof item.label).toBe('string');
        expect(Number.isInteger(item.sort_order)).toBe(true);
      }
      assertSorted(items);
    }

    expect((data.poi_types ?? []).some((item) => item.key === disabledKey)).toBe(false);
  });

  it('returns only the client config whitelist and leaks no secrets', async () => {
    const prisma = getAuthTestPrisma();
    const sensitiveKey = uniqueKey('internal_admin_password');
    const malformedZoomKey = 'map.default_zoom';
    createdConfigKeys.push(sensitiveKey);

    await prisma.config.create({
      data: {
        config_key: sensitiveKey,
        config_value: 'http://internal.service.local/secret',
        description: 'must never reach clients',
      },
    });
    await prisma.config.upsert({
      where: { config_key: malformedZoomKey },
      create: {
        config_key: malformedZoomKey,
        config_value: 'not-a-number',
        description: 'malformed whitelist value must fall back',
      },
      update: { config_value: 'not-a-number' },
    });
    createdConfigKeys.push(malformedZoomKey);

    const res = await request(server).get('/api/v1/config').set(PUBLIC_HEADERS).expect(200);
    const data = res.body.data;

    expect(data).toEqual({
      map: { default_latitude: 22.5431, default_longitude: 114.0579, default_zoom: 12 },
      features: { map_tab: true, search: true, banned_spots: true },
      data_freshness: { core_days: 30, normal_days: 90 },
    });
    expect(Object.keys(data).sort()).toEqual(['data_freshness', 'features', 'map']);
    expect(Object.keys(data.map).sort()).toEqual([
      'default_latitude',
      'default_longitude',
      'default_zoom',
    ]);
    expect(Object.keys(data.features).sort()).toEqual(['banned_spots', 'map_tab', 'search']);
    expect(Object.keys(data.data_freshness).sort()).toEqual(['core_days', 'normal_days']);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|key|password|internal/i);
  });

  it('returns a stable config etag, cache-control and 304 on If-None-Match', async () => {
    const prisma = getAuthTestPrisma();
    await prisma.config.deleteMany({ where: { config_key: 'features.search' } });

    const first = await request(server).get('/api/v1/config').set(PUBLIC_HEADERS).expect(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(first.headers['cache-control']).toBe('public, max-age=600');

    const repeated = await request(server)
      .get('/api/v1/config')
      .set(PUBLIC_HEADERS)
      .expect(200);
    expect(repeated.headers.etag).toBe(first.headers.etag);

    const notModified = await request(server)
      .get('/api/v1/config')
      .set(PUBLIC_HEADERS)
      .set('If-None-Match', first.headers.etag as string)
      .expect(304);
    expect(notModified.text).toBe('');
    expect(notModified.headers['cache-control']).toBe('public, max-age=600');

    try {
      await prisma.config.create({
        data: {
          config_key: 'features.search',
          config_value: 'false',
          description: 'e2e config etag change',
        },
      });

      const changed = await request(server)
        .get('/api/v1/config')
        .set(PUBLIC_HEADERS)
        .expect(200);
      expect(changed.body.data.features.search).toBe(false);
      expect(changed.headers.etag).not.toBe(first.headers.etag);
    } finally {
      await prisma.config.deleteMany({ where: { config_key: 'features.search' } });
    }

    const restored = await request(server)
      .get('/api/v1/config')
      .set(PUBLIC_HEADERS)
      .expect(200);
    expect(restored.headers.etag).toBe(first.headers.etag);

    const cors = await request(server)
      .get('/api/v1/config')
      .set(PUBLIC_HEADERS)
      .set('Origin', 'https://admin.szfisher.test')
      .expect(200);
    expect(cors.headers['access-control-expose-headers']).toContain('ETag');
    expect(cors.headers['access-control-expose-headers']).toContain('Cache-Control');
  });

  it('lets super admin add a dictionary item visible in the public dictionary', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const key = uniqueKey('test_d7_poi');
    createdDictionaryKeys.push({ dict_type: 'poi_type', dict_key: key });

    const created = await request(server)
      .post('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_type: 'poi_type', dict_key: key, dict_label: '测试类型' })
      .expect(201);

    expect(created.body.data).toMatchObject({
      dict_type: 'poi_type',
      dict_key: key,
      dict_label: '测试类型',
      sort_order: 0,
      enabled: true,
      parent_key: null,
    });

    const duplicate = await request(server)
      .post('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_type: 'poi_type', dict_key: key, dict_label: '重复类型' })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: ERROR_CODES.STATE_CONFLICT, data: null });
    expect(duplicate.body.message).toContain(key);

    const publicRes = await publicGetDictionaries().expect(200);
    expect(
      (publicRes.body.data.poi_types as DictionaryItem[]).some((item) => item.key === key),
    ).toBe(true);
  });

  it('blocks operators and reviewers from dictionary writes', async () => {
    const targetKey = 'food';

    for (const role of [ADMIN_ROLE.OPERATOR, ADMIN_ROLE.REVIEWER]) {
      const session = await loginAs(app, role);

      const createRes = await request(server)
        .post('/api/v1/admin/dictionaries')
        .set(clientHeaders())
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({ dict_type: 'poi_type', dict_key: uniqueKey('test_d7_denied'), dict_label: '拒绝' })
        .expect(403);
      expect(createRes.body).toMatchObject({ code: ERROR_CODES.FORBIDDEN, data: null });

      const updateRes = await request(server)
        .put(`/api/v1/admin/dictionaries/poi_type/${targetKey}`)
        .set(clientHeaders())
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({ dict_label: '越权修改' })
        .expect(403);
      expect(updateRes.body).toMatchObject({ code: ERROR_CODES.FORBIDDEN, data: null });
    }
  });

  it('updates label, order, enabled and parent key and writes an audit row', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const key = `test_d7_audit_${'k'.repeat(48)}`; // 8 + 1 + 61 = 70 chars, beyond audit_log.entity_id
    createdDictionaryKeys.push({ dict_type: 'poi_type', dict_key: key });

    const created = await request(server)
      .post('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_type: 'poi_type', dict_key: key, dict_label: '初始标签' })
      .expect(201);
    expect(created.body.data.dict_label).toBe('初始标签');

    const updated = await request(server)
      .put(`/api/v1/admin/dictionaries/poi_type/${key}`)
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_label: '更新标签', sort_order: 77, enabled: false, parent_key: 'food' })
      .expect(200);

    expect(updated.body.data).toMatchObject({
      dict_type: 'poi_type',
      dict_key: key,
      dict_label: '更新标签',
      sort_order: 77,
      enabled: false,
      parent_key: 'food',
    });

    const adminList = await request(server)
      .get('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    const listed = (adminList.body.data.items as MetricDictionaryItem[]).find(
      (item) => item.dict_type === 'poi_type' && item.dict_key === key,
    );
    expect(listed).toMatchObject({
      dict_label: '更新标签',
      sort_order: 77,
      enabled: false,
      parent_key: 'food',
    });

    const auditEntityId = `poi_type:${key}`.slice(0, 64);
    const auditRows = await getAuthTestPrisma().auditLog.findMany({
      where: {
        admin_id: superAdmin.admin.adminId,
        entity_type: 'dictionary',
        entity_id: auditEntityId,
        action: { in: ['dictionary.create', 'dictionary.update'] },
      },
      orderBy: { created_at: 'asc' },
    });
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]).toMatchObject({ action: 'dictionary.create', entity_type: 'dictionary' });
    expect(auditRows[0]?.after_json).toMatchObject({ dict_label: '初始标签', enabled: true });
    expect(auditRows[1]).toMatchObject({ action: 'dictionary.update', entity_type: 'dictionary' });
    expect(auditRows[1]?.before_json).toMatchObject({ dict_label: '初始标签', sort_order: 0 });
    expect(auditRows[1]?.after_json).toMatchObject({
      dict_label: '更新标签',
      sort_order: 77,
      enabled: false,
      parent_key: 'food',
    });

    const missing = await request(server)
      .put(`/api/v1/admin/dictionaries/poi_type/${uniqueKey('test_d7_missing')}`)
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_label: '不存在' })
      .expect(404);
    expect(missing.body).toMatchObject({ code: ERROR_CODES.NOT_FOUND, data: null });
  });

  it('keeps the public etag stable and changes it after an enabled mutation', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const key = uniqueKey('test_d7_etag');
    createdDictionaryKeys.push({ dict_type: 'poi_type', dict_key: key });

    const first = await publicGetDictionaries().expect(200);
    const repeated = await publicGetDictionaries().expect(200);
    expect(repeated.headers.etag).toBe(first.headers.etag);

    await request(server)
      .post('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .send({ dict_type: 'poi_type', dict_key: key, dict_label: 'ETag 变更' })
      .expect(201);

    const changed = await publicGetDictionaries().expect(200);
    expect(changed.headers.etag).toBeTruthy();
    expect(changed.headers.etag).not.toBe(first.headers.etag);

    await getAuthTestPrisma().dictionary.delete({
      where: { dict_type_dict_key: { dict_type: 'poi_type', dict_key: key } },
    });
    createdDictionaryKeys.splice(
      createdDictionaryKeys.findIndex(
        (entry) => entry.dict_type === 'poi_type' && entry.dict_key === key,
      ),
      1,
    );

    const restored = await publicGetDictionaries().expect(200);
    expect(restored.headers.etag).toBe(first.headers.etag);
  });

  it('rejects malformed admin dictionary requests with 40001', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const headers = {
      ...clientHeaders(),
      Cookie: superAdmin.cookie,
      'X-CSRF-Token': superAdmin.csrf,
    };
    const invalidBodies = [
      { dict_type: 'poi_type', dict_key: '', dict_label: '空 key' },
      { dict_type: 'unknown_type', dict_key: 'some_key', dict_label: '未知类型' },
      { dict_type: 'poi_type', dict_key: 'some_key', dict_label: '额外字段', extra: true },
      { dict_type: 'poi_type', dict_key: 'some_key' },
    ];

    for (const body of invalidBodies) {
      const res = await request(server)
        .post('/api/v1/admin/dictionaries')
        .set(headers)
        .send(body)
        .expect(400);
      expect(res.body).toMatchObject({ code: ERROR_CODES.VALIDATION, data: null });
    }

    const invalidUpdate = await request(server)
      .put('/api/v1/admin/dictionaries/poi_type/food')
      .set(headers)
      .send({ sort_order: 'not-a-number' })
      .expect(400);
    expect(invalidUpdate.body).toMatchObject({ code: ERROR_CODES.VALIDATION, data: null });
  });

  it('keeps public cache policy and marks admin dictionary responses no-store', async () => {
    const publicFirst = await publicGetDictionaries().expect(200);
    expect(publicFirst.headers['cache-control']).toBe('public, max-age=600');

    const notModified = await publicGetDictionaries()
      .set('If-None-Match', publicFirst.headers.etag as string)
      .expect(304);
    expect(notModified.headers['cache-control']).toBe('public, max-age=600');

    const superAdmin = await loginAsSuperAdmin(app);
    const admin = await request(server)
      .get('/api/v1/admin/dictionaries')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    expect(admin.headers['cache-control']).toBe('no-store');
  });

  it('exposes concrete enveloped response types in the generated client schema', () => {
    // These assignments fail to compile if openapi-typescript emits `never`.
    const dictionaries: PublicDictionariesResponse = {
      code: ERROR_CODES.SUCCESS,
      message: 'ok',
      request_id: 'req_contract_dictionaries',
      data: {
        districts: [],
        fish_types: [],
        fee_status: [],
        water_types: [],
        venue_types: [],
        fishing_methods: [],
        poi_types: [],
      },
    };
    const config: ClientConfigResponse = {
      code: ERROR_CODES.SUCCESS,
      message: 'ok',
      request_id: 'req_contract_config',
      data: {
        map: { default_latitude: 22.5431, default_longitude: 114.0579, default_zoom: 12 },
        features: { map_tab: true, search: true, banned_spots: true },
        data_freshness: { core_days: 30, normal_days: 90 },
      },
    };

    expect(dictionaries.data.districts).toEqual([]);
    expect(config.data.map.default_zoom).toBe(12);
  });
});
