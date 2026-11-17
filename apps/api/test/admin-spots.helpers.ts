import type { INestApplication } from '@nestjs/common';
import type { Prisma, Spot } from '@prisma/client';
import request from 'supertest';
import { ulid } from 'ulid';
import {
  clientHeaders,
  getAuthTestPrisma,
  type AuthSession,
} from './support/auth-helpers';

const trackedSpotIds: string[] = [];

export async function seedSpot(
  overrides: Partial<Prisma.SpotUncheckedCreateInput> & { spot_name: string },
): Promise<Spot> {
  const prisma = getAuthTestPrisma();
  const row = await prisma.spot.create({
    data: {
      spot_id: overrides.spot_id ?? ulid(),
      ...overrides,
    },
  });
  trackedSpotIds.push(row.spot_id);
  return row;
}

export async function createDraft(
  app: INestApplication,
  session: AuthSession,
  overrides: Record<string, unknown> = {},
): Promise<{ spot_id: string } & Record<string, unknown>> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/admin/spots')
    .set(clientHeaders())
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send({
      spot_name: `测试钓点-${ulid().slice(-6)}`,
      ...overrides,
    })
    .expect(201);
  const spot = response.body.data.spot as { spot_id: string } & Record<string, unknown>;
  trackedSpotIds.push(spot.spot_id);
  return spot;
}

export async function createCompleteDraft(
  app: INestApplication,
  session: AuthSession,
  overrides: Record<string, unknown> = {},
): Promise<{ spot_id: string } & Record<string, unknown>> {
  return createDraft(app, session, {
    district: '南山区',
    latitude: '22.517600',
    longitude: '113.952300',
    nav_latitude: '22.517600',
    nav_longitude: '113.952300',
    address: '测试地址',
    fish_types: ['luofei'],
    fee_status: 'free',
    water_type: 'sea',
    venue_type: 'wild',
    open_status: 'open',
    ...overrides,
  });
}

export async function markVerifiedInDb(spotId: string): Promise<void> {
  await getAuthTestPrisma().spot.update({
    where: { spot_id: spotId },
    data: { verified_at: new Date() },
  });
}

export async function createVerifiedCompleteDraft(
  app: INestApplication,
  session: AuthSession,
  overrides: Record<string, unknown> = {},
): Promise<{ spot_id: string } & Record<string, unknown>> {
  const draft = await createCompleteDraft(app, session, overrides);
  await markVerifiedInDb(draft.spot_id);
  return draft;
}

export async function createPublishedSpot(
  overrides: Partial<Prisma.SpotUncheckedCreateInput> = {},
): Promise<Spot> {
  return seedSpot({
    spot_name: `已发布钓点-${ulid().slice(-6)}`,
    district: '南山区',
    latitude: '22.517600',
    longitude: '113.952300',
    nav_latitude: '22.517600',
    nav_longitude: '113.952300',
    address: '测试地址',
    fish_types: ['luofei'],
    fee_status: 'free',
    water_type: 'sea',
    venue_type: 'wild',
    open_status: 'open',
    status: 'published',
    source: 'operation',
    verified_at: new Date(),
    ...overrides,
  });
}

export async function cleanupAdminSpotTestData(): Promise<void> {
  if (trackedSpotIds.length === 0) {
    return;
  }
  const prisma = getAuthTestPrisma();
  await prisma.spot.deleteMany({ where: { spot_id: { in: [...trackedSpotIds] } } });
  trackedSpotIds.length = 0;
}

export function trackSpotId(spotId: string): void {
  trackedSpotIds.push(spotId);
}
