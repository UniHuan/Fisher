import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../src/common/errors/app-error';
import { HealthController } from '../src/modules/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './create-test-app';

const TEST_DATABASE_URL = 'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;

const prisma = new PrismaClient();

const VALID_SPOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const INVALID_OPEN_STATUS_SPOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const MINIMAL_DRAFT_SPOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

describe('database schema', () => {
  beforeAll(async () => {
    await prisma.spot.deleteMany({
      where: {
        spot_id: { in: [VALID_SPOT_ID, INVALID_OPEN_STATUS_SPOT_ID, MINIMAL_DRAFT_SPOT_ID] },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('applies migration and seeds ten districts', async () => {
    const rows = await prisma.dictionary.findMany({ where: { dict_type: 'district' } });
    expect(rows).toHaveLength(10);
  });

  it('stores coordinates as decimal strings', async () => {
    const spot = await prisma.spot.create({
      data: {
        spot_id: VALID_SPOT_ID,
        spot_name: '测试钓点',
        latitude: '22.517600',
        longitude: '113.952300',
        source: 'operation',
        status: 'draft',
      },
    });
    expect(spot.latitude?.toString()).toBe('22.5176');
  });

  it('rejects unknown open status', async () => {
    await expect(
      prisma.spot.create({
        data: {
          spot_id: INVALID_OPEN_STATUS_SPOT_ID,
          spot_name: '非法状态',
          open_status: 'unknown',
          source: 'operation',
          status: 'draft',
        },
      }),
    ).rejects.toThrow();
  });

  it('allows a draft with only spot_id and spot_name', async () => {
    const spot = await prisma.spot.create({
      data: {
        spot_id: MINIMAL_DRAFT_SPOT_ID,
        spot_name: '最简草稿钓点',
      },
    });
    expect(spot.status).toBe('draft');
    expect(spot.source).toBeNull();
  });

  it('serves readiness with a database round trip', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer()).get('/ready').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});

describe('readiness failure handling', () => {
  it('maps a database failure to AppError 50301 with HTTP 503', async () => {
    const stub = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('database down')),
    };
    const controller = new HealthController(stub as unknown as PrismaService);

    await expect(controller.ready()).rejects.toBeInstanceOf(AppError);
    await expect(controller.ready()).rejects.toMatchObject({
      code: ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      httpStatus: 503,
    });
  });
});
