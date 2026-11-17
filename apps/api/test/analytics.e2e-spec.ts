import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  cleanupAdminSpotTestData,
  createPublishedSpot,
} from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  getAuthTestPrisma,
} from './support/auth-helpers';

jest.setTimeout(30000);

const CLIENT_HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
  'User-Agent': 'szfisher-miniprogram-e2e/1.0.0',
};

async function waitForEvent(
  prisma: PrismaClient,
  requestId: string,
  eventName: string,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const row = await prisma.analyticsEvent.findFirst({
      where: { request_id: requestId, event_name: eventName },
    });
    if (row !== null) {
      return row as unknown as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe('analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const requestIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getAuthTestPrisma();
  });

  afterAll(async () => {
    if (requestIds.length > 0) {
      await prisma.analyticsEvent.deleteMany({
        where: { request_id: { in: requestIds } },
      });
    }
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  it('records server list, search and detail events with request correlation', async () => {
    const spot = await createPublishedSpot({
      spot_name: `分析测试钓点-${Date.now()}`,
    });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/spots')
      .query({ page: 1, page_size: 5 })
      .set(CLIENT_HEADERS)
      .expect(200);
    const listRequestId = listResponse.headers['x-request-id'] as string;
    requestIds.push(listRequestId);
    const listEvent = await waitForEvent(prisma, listRequestId, 'api_spot_list');
    expect(listEvent).toMatchObject({
      event_name: 'api_spot_list',
      client_type: 'miniprogram',
      app_version: '1.0.0',
    });
    expect(listEvent?.properties).toMatchObject({
      has_location: false,
      sort: 'recommended',
    });

    const searchResponse = await request(app.getHttpServer())
      .get('/api/v1/spots')
      .query({ keyword: '分析测试', page: 1, page_size: 5 })
      .set(CLIENT_HEADERS)
      .expect(200);
    const searchRequestId = searchResponse.headers['x-request-id'] as string;
    requestIds.push(searchRequestId);
    const searchEvent = await waitForEvent(prisma, searchRequestId, 'api_search');
    expect(searchEvent).not.toBeNull();

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/spots/${spot.spot_id}`)
      .set(CLIENT_HEADERS)
      .expect(200);
    const detailRequestId = detailResponse.headers['x-request-id'] as string;
    requestIds.push(detailRequestId);
    const detailEvent = await waitForEvent(prisma, detailRequestId, 'api_spot_detail');
    expect(detailEvent?.properties).toMatchObject({
      spot_id: spot.spot_id,
      open_status: 'open',
    });
  });
});
