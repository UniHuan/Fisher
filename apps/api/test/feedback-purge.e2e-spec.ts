import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  purgeFeedback,
  FEEDBACK_ORPHAN_IMAGE_MS,
  FEEDBACK_RETENTION_MS,
} from '../src/jobs/purge-feedback.job';
import { withAdvisoryLock } from '../src/common/db/advisory-lock';
import { FEEDBACK_PURGE_LOCK_KEY } from '../src/jobs/purge-feedback.job';
import { StorageService } from '../src/modules/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './create-test-app';

jest.setTimeout(60000);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface SeededImage {
  imageId: string;
  key: string;
}

describe('Feedback purge job (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let storageRoot: string;
  let userId = '';

  function objectPath(key: string): string {
    return join(storageRoot, 'working', ...key.split('/'));
  }

  async function seedImage(input: {
    createdAt: Date;
    status?: string;
  }): Promise<SeededImage> {
    const imageId = ulid();
    const key = `feedback/${userId}/${imageId}.webp`;
    await storage.putObject(key, Buffer.from('webp-bytes'), 'image/webp');
    await prisma.feedbackImage.create({
      data: {
        image_id: imageId,
        user_id: userId,
        object_key: key,
        size_bytes: 10,
        status: input.status ?? 'pending',
        created_at: input.createdAt,
      },
    });
    return { imageId, key };
  }

  async function seedFeedback(input: {
    createdAt: Date;
    imageKeys: string[];
    category?: string;
  }): Promise<string> {
    const feedbackId = ulid();
    await prisma.trialFeedback.create({
      data: {
        feedback_id: feedbackId,
        user_id: userId,
        category: input.category ?? 'bug',
        content: '清理任务测试反馈内容不少于十个字',
        image_keys: input.imageKeys,
        created_at: input.createdAt,
      },
    });
    return feedbackId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    storageRoot = process.env.STORAGE_LOCAL_ROOT as string;
    userId = ulid();
    await prisma.appUser.create({
      data: { user_id: userId, nickname: '反馈清理测试' },
    });
  });

  afterAll(async () => {
    await prisma.trialFeedback.deleteMany({ where: { user_id: userId } });
    await prisma.feedbackImage.deleteMany({ where: { user_id: userId } });
    await prisma.appUser.deleteMany({ where: { user_id: userId } });
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('deletes pending images older than 24 hours and keeps fresh ones', async () => {
    const now = new Date();
    const stale = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_ORPHAN_IMAGE_MS - HOUR_MS),
    });
    const fresh = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_ORPHAN_IMAGE_MS + HOUR_MS),
    });

    const result = await purgeFeedback(prisma, storage, now);
    expect(result).not.toBeNull();
    expect(result?.images_deleted).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.feedbackImage.findUnique({ where: { image_id: stale.imageId } }),
    ).toBeNull();
    expect(existsSync(objectPath(stale.key))).toBe(false);

    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { image_id: fresh.imageId } }))
        .status,
    ).toBe('pending');
    expect(existsSync(objectPath(fresh.key))).toBe(true);
  });

  it('marks a referenced pending image used instead of deleting its object', async () => {
    const now = new Date();
    const image = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_ORPHAN_IMAGE_MS - HOUR_MS),
    });
    const feedbackId = await seedFeedback({
      createdAt: new Date(now.getTime() - 2 * HOUR_MS),
      imageKeys: [image.key],
    });

    await purgeFeedback(prisma, storage, now);

    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { image_id: image.imageId } }))
        .status,
    ).toBe('used');
    expect(existsSync(objectPath(image.key))).toBe(true);

    await prisma.trialFeedback.delete({ where: { feedback_id: feedbackId } });
    await prisma.feedbackImage.delete({ where: { image_id: image.imageId } });
    await storage.deleteObject(image.key);
  });

  it('deletes feedback older than 90 days with its images and objects', async () => {
    const now = new Date();
    const oldImage = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS - DAY_MS),
      status: 'used',
    });
    const oldFeedbackId = await seedFeedback({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS - DAY_MS),
      imageKeys: [oldImage.key],
    });
    const recentImage = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS + DAY_MS),
      status: 'used',
    });
    const recentFeedbackId = await seedFeedback({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS + DAY_MS),
      imageKeys: [recentImage.key],
    });

    const result = await purgeFeedback(prisma, storage, now);
    expect(result).not.toBeNull();
    expect(result?.feedback_deleted).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.trialFeedback.findUnique({ where: { feedback_id: oldFeedbackId } }),
    ).toBeNull();
    expect(
      await prisma.feedbackImage.findUnique({ where: { image_id: oldImage.imageId } }),
    ).toBeNull();
    expect(existsSync(objectPath(oldImage.key))).toBe(false);

    expect(
      await prisma.trialFeedback.findUnique({ where: { feedback_id: recentFeedbackId } }),
    ).not.toBeNull();
    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { image_id: recentImage.imageId } }))
        .status,
    ).toBe('used');
    expect(existsSync(objectPath(recentImage.key))).toBe(true);

    await prisma.trialFeedback.delete({ where: { feedback_id: recentFeedbackId } });
    await prisma.feedbackImage.delete({ where: { image_id: recentImage.imageId } });
    await storage.deleteObject(recentImage.key);
  });

  it('keeps an object still referenced by a retained feedback', async () => {
    const now = new Date();
    const shared = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS - DAY_MS),
      status: 'used',
    });
    const oldFeedbackId = await seedFeedback({
      createdAt: new Date(now.getTime() - FEEDBACK_RETENTION_MS - DAY_MS),
      imageKeys: [shared.key],
    });
    const retainedFeedbackId = await seedFeedback({
      createdAt: new Date(now.getTime() - DAY_MS),
      imageKeys: [shared.key],
    });

    await purgeFeedback(prisma, storage, now);

    expect(
      await prisma.trialFeedback.findUnique({ where: { feedback_id: oldFeedbackId } }),
    ).toBeNull();
    expect(
      await prisma.trialFeedback.findUnique({ where: { feedback_id: retainedFeedbackId } }),
    ).not.toBeNull();
    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { image_id: shared.imageId } }))
        .status,
    ).toBe('deleted');
    expect(existsSync(objectPath(shared.key))).toBe(true);

    await prisma.trialFeedback.delete({ where: { feedback_id: retainedFeedbackId } });
    await prisma.feedbackImage.delete({ where: { image_id: shared.imageId } });
    await storage.deleteObject(shared.key);
  });

  it('skips the run while another process holds the advisory lock', async () => {
    const now = new Date();
    const stale = await seedImage({
      createdAt: new Date(now.getTime() - FEEDBACK_ORPHAN_IMAGE_MS - HOUR_MS),
    });

    const skipped = await withAdvisoryLock(prisma, FEEDBACK_PURGE_LOCK_KEY, () =>
      purgeFeedback(prisma, storage, now),
    );
    expect(skipped).toBeNull();
    expect(
      (await prisma.feedbackImage.findUniqueOrThrow({ where: { image_id: stale.imageId } }))
        .status,
    ).toBe('pending');
    expect(existsSync(objectPath(stale.key))).toBe(true);

    await prisma.feedbackImage.delete({ where: { image_id: stale.imageId } });
    await storage.deleteObject(stale.key);
  });
});
