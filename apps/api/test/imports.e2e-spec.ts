import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ADMIN_ROLE } from '@szfisher/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  cleanupAdminSpotTestData,
  seedSpot,
} from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import { IMPORT_COLUMNS } from '../src/modules/imports/import.constants';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  type AuthSession,
} from './support/auth-helpers';

jest.setTimeout(30000);

const IMPORT_PREFIX = '导入测试-';
const DUPLICATE_SEED_NAME = '导入重复参照钓点';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildImportFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('钓点导入');
  sheet.addRow(IMPORT_COLUMNS.map((column) => column.label));
  const base: Record<string, string> = {
    spot_name: '',
    district: '南山区',
    address: '深圳市南山区测试地址',
    latitude: '22.517600',
    longitude: '113.952300',
    nav_latitude: '',
    nav_longitude: '',
    parking_latitude: '',
    parking_longitude: '',
    fish_types: '罗非;鲫鱼',
    fee_status: '免费',
    fee_unit: '',
    fee_detail: '免费开放',
    water_type: '海域',
    venue_type: '野钓',
    fishing_method: '台钓',
    open_status: '开放',
    ban_note: '',
    open_hours: '06:00-22:00',
    description: '导入测试简介',
    tips: '注意安全',
    images: '',
    source: '运营',
    verified_at: '2026-11-01',
    sort_weight: '10',
    is_core: '否',
  };
  const add = (overrides: Record<string, string>): void => {
    const row = { ...base, ...overrides };
    sheet.addRow(IMPORT_COLUMNS.map((column) => row[column.key] ?? ''));
  };
  add({ spot_name: `${IMPORT_PREFIX}深圳湾A` });
  add({
    spot_name: `${IMPORT_PREFIX}深圳湾A附近`,
    latitude: '22.517700',
    longitude: '113.952400',
  });
  add({
    spot_name: `${IMPORT_PREFIX}大鹏C`,
    district: '大鹏新区',
    latitude: '22.594500',
    longitude: '114.499800',
  });
  add({
    spot_name: `${IMPORT_PREFIX}非法行`,
    district: '不存在区',
    latitude: '',
    longitude: '',
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('imports (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;
  let operator: AuthSession;
  let file: Buffer;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = getAuthTestPrisma();
    operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    file = await buildImportFile();
    await seedSpot({
      spot_name: DUPLICATE_SEED_NAME,
      district: '南山区',
      latitude: '22.517600',
      longitude: '113.952300',
    });
  });

  afterAll(async () => {
    await prisma.spot.deleteMany({ where: { spot_name: { startsWith: IMPORT_PREFIX } } });
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  function upload(session: AuthSession = operator) {
    return request(server)
      .post('/api/v1/admin/spots/import')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .attach('file', file, {
        filename: 'spots.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
  }

  async function waitForJob(jobId: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await request(server)
        .get(`/api/v1/admin/imports/${jobId}`)
        .set(clientHeaders())
        .set('Cookie', operator.cookie)
        .expect(200);
      const job = response.body.data as Record<string, unknown>;
      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }
      await sleep(100);
    }
    throw new Error('Import job did not finish in time');
  }

  it('downloads the Excel template with all import columns', async () => {
    const response = await request(server)
      .get('/api/v1/admin/spots/import-template')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.Workbook();
    const templateBuffer = response.body as Buffer;
    const templateArrayBuffer = templateBuffer.buffer.slice(
      templateBuffer.byteOffset,
      templateBuffer.byteOffset + templateBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(templateArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(1).values).toEqual(
      expect.arrayContaining(IMPORT_COLUMNS.map((column) => column.label)),
    );
    expect(workbook.worksheets[1]?.name).toBe('填写说明');
  });

  it('imports valid rows as drafts, reports invalid rows and duplicates, and is file-idempotent', async () => {
    const uploadResponse = await upload().expect(201);
    const jobId = uploadResponse.body.data.job_id as string;
    expect(uploadResponse.body.data.status).toMatch(/^(pending|processing)$/);

    const job = await waitForJob(jobId);
    expect(job).toMatchObject({
      job_id: jobId,
      status: 'completed',
      total_rows: 4,
      success_rows: 3,
      failed_rows: 1,
      has_error_report: true,
    });

    const imported = await prisma.spot.findMany({
      where: { spot_name: { startsWith: IMPORT_PREFIX } },
      orderBy: { spot_name: 'asc' },
    });
    expect(imported).toHaveLength(3);
    expect(imported.every((row) => row.status === 'draft')).toBe(true);
    expect(imported.every((row) => row.source === 'operation')).toBe(true);
    expect(imported[0]?.fish_types).toEqual(expect.arrayContaining(['luofei']));
    expect(imported[0]?.verified_at).not.toBeNull();

    const report = await request(server)
      .get(`/api/v1/admin/imports/${jobId}/errors`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(report.headers['content-type']).toContain('text/csv');
    expect(report.text).toContain('level,field,message');
    expect(report.text).toContain('error');
    expect(report.text).toContain('warning');
    expect(report.text).toContain('不存在区');
    expect(report.text).toContain('duplicate');

    const repeated = await upload().expect(201);
    expect(repeated.body.data.job_id).toBe(jobId);
    const countAfterRepeat = await prisma.spot.count({
      where: { spot_name: { startsWith: IMPORT_PREFIX } },
    });
    expect(countAfterRepeat).toBe(3);

    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'spot.import',
        entity_id: jobId,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('blocks reviewers and unauthenticated uploads', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    await request(server)
      .post('/api/v1/admin/spots/import')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .set('X-CSRF-Token', reviewer.csrf)
      .attach('file', file, { filename: 'blocked.xlsx' })
      .expect(403);
    await request(server)
      .get('/api/v1/admin/spots/import-template')
      .set(clientHeaders())
      .expect(401);
  });
});
