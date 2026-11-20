import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
import { cleanupAuthTestData } from './support/auth-helpers';

const prisma = new PrismaClient();

describe('UGC schema (e2e)', () => {
  let userId = '';
  let reportId = '';

  afterAll(async () => {
    if (userId) {
      await prisma.reportMediaCheck.deleteMany({ where: { report_id: reportId } });
      await prisma.userSession.deleteMany({ where: { user_id: userId } });
      await prisma.ugcUpload.deleteMany({ where: { user_id: userId } });
      await prisma.report.deleteMany({ where: { report_id: reportId } });
      await prisma.appUser.deleteMany({ where: { user_id: userId } });
    }
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  it('persists a report with a media check, upload and session', async () => {
    const user = await prisma.appUser.create({
      data: { user_id: ulid(), nickname: '钓友 A7K2' },
    });
    userId = user.user_id;
    const spot = await seedSpot({
      spot_name: 'UGC schema test',
      status: 'published',
      open_status: 'open',
    });
    const report = await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: spot.spot_id,
        user_id: user.user_id,
        content_type: 'catch',
        content: '测试鱼获',
        fish_key: 'luofei',
        catch_weight_kg: '2.50',
      },
    });
    reportId = report.report_id;
    const upload = await prisma.ugcUpload.create({
      data: {
        upload_id: ulid(),
        user_id: user.user_id,
        object_key: `ugc/${user.user_id}/${ulid()}.webp`,
        size_bytes: 100,
      },
    });
    const check = await prisma.reportMediaCheck.create({
      data: {
        trace_id: `trace-${ulid()}`,
        report_id: report.report_id,
        image_key: upload.object_key,
      },
    });
    const session = await prisma.userSession.create({
      data: {
        session_id: ulid(),
        user_id: user.user_id,
        refresh_token_hash: 'a'.repeat(64),
        expires_at: new Date(Date.now() + 86400000),
      },
    });
    expect(report.moderation_status).toBe('machine_pending');
    expect(check.status).toBe('pending');
    expect(session.revoked_at).toBeNull();
  });
});
