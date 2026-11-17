import type { INestApplication } from '@nestjs/common';
import { ADMIN_ROLE } from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import {
  cleanupAdminSpotTestData,
  createCompleteDraft,
  markVerifiedInDb,
  seedSpot,
} from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  loginAs,
} from './support/auth-helpers';

jest.setTimeout(30000);

function pngBuffer(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 120, b: 180 },
    },
  })
    .png()
    .toBuffer();
}

describe('uploads and media (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let spotId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    const spot = await seedSpot({ spot_name: '上传测试钓点' });
    spotId = spot.spot_id;
  });

  afterAll(async () => {
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  it('uploads, compresses, signs and serves a draft image without client headers', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const png = await pngBuffer();
    const response = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', spotId)
      .field('purpose', 'detail')
      .attach('file', png, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    const upload = response.body.data;
    expect(upload.key).toMatch(/^spots\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/);
    expect(upload.preview_url).toContain('/api/v1/uploads/preview?');
    expect(upload.width).toBeLessThanOrEqual(1600);
    expect(upload.height).toBeLessThanOrEqual(1600);
    expect(upload.size_bytes).toBeLessThanOrEqual(300 * 1024);

    const preview = await request(server).get(upload.preview_url).expect(200);
    expect(preview.headers['content-type']).toContain('image/webp');
    expect(preview.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(preview.body.length).toBeLessThanOrEqual(300 * 1024);

    const missingPublic = await request(server)
      .get(`/api/v1/uploads/public/${upload.key}`)
      .expect(404);
    expect(missingPublic.body.code).toBe(40401);
  });

  it('rejects tampered preview signatures', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const png = await pngBuffer(320, 240);
    const response = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', spotId)
      .field('purpose', 'cover')
      .attach('file', png, { filename: 'cover.png', contentType: 'image/png' })
      .expect(201);
    const previewUrl = response.body.data.preview_url as string;
    const tampered = previewUrl.replace(/signature=[^&]+/, 'signature=invalid');
    const preview = await request(server).get(tampered).expect(404);
    expect(preview.body.code).toBe(40401);
  });

  it('rejects non-image magic bytes even when the filename is misleading', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const response = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', spotId)
      .field('purpose', 'detail')
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(response.body.code).toBe(40001);
  });

  it('rejects files over 10 MB and reviewer writes', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const tooLarge = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', spotId)
      .field('purpose', 'detail')
      .attach('file', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' })
      .expect(413);
    expect(tooLarge.body.code).toBe(41301);

    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const png = await pngBuffer(100, 100);
    await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .set('X-CSRF-Token', reviewer.csrf)
      .field('spot_id', spotId)
      .field('purpose', 'detail')
      .attach('file', png, { filename: 'reviewer.png', contentType: 'image/png' })
      .expect(403);
  });

  it('returns 404 for an unknown spot', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const png = await pngBuffer(100, 100);
    const response = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', ulid())
      .field('purpose', 'detail')
      .attach('file', png, { filename: 'missing.png', contentType: 'image/png' })
      .expect(404);
    expect(response.body.code).toBe(40401);
  });

  it('copies working images to the public bucket when publishing', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const draft = await createCompleteDraft(app, operator, { spot_name: '发布图片钓点' });
    const png = await pngBuffer(640, 480);
    const uploadResponse = await request(server)
      .post('/api/v1/admin/uploads')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .field('spot_id', draft.spot_id)
      .field('purpose', 'detail')
      .attach('file', png, { filename: 'publish.png', contentType: 'image/png' })
      .expect(201);
    const key = uploadResponse.body.data.key as string;

    await request(server)
      .put(`/api/v1/admin/spots/${draft.spot_id}`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .send({ images: [key], cover_image_key: key })
      .expect(200);

    await markVerifiedInDb(draft.spot_id);
    const published = await request(server)
      .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(200);

    expect(published.body.data.status).toBe('published');
    expect(published.body.data.image_urls).toEqual([
      expect.stringContaining(`/api/v1/uploads/public/${key}`),
    ]);
    expect(published.body.data.cover_image_url).toContain(
      `/api/v1/uploads/public/${key}`,
    );
    const publicImage = await request(server)
      .get(`/api/v1/uploads/public/${key}`)
      .expect(200);
    expect(publicImage.headers['content-type']).toContain('image/webp');
    expect(publicImage.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
