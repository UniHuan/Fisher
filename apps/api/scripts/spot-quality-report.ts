import { PrismaClient } from '@prisma/client';

const strict = process.argv.includes('--strict');
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required');
}

const prisma = new PrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function ageDays(value: Date | null): number | null {
  return value === null ? null : Math.max(0, Math.floor((Date.now() - value.getTime()) / DAY_MS));
}

async function main(): Promise<void> {
  const rows = await prisma.spot.findMany({
    where: { deleted_at: null },
    include: { _count: { select: { spot_pois: true } } },
  });
  const published = rows.filter((row) => row.status === 'published');
  const requiredFields = [
    'spot_name',
    'district',
    'latitude',
    'longitude',
    'nav_latitude',
    'nav_longitude',
    'address',
    'fish_types',
    'fee_status',
    'water_type',
    'venue_type',
    'open_status',
    'verified_at',
    'source',
  ] as const;
  const incomplete = published.filter((row) =>
    requiredFields.some((field) => {
      const value = row[field];
      if (Array.isArray(value)) {
        return value.length === 0;
      }
      if (field === 'verified_at') {
        return value === null;
      }
      if (field === 'latitude' || field === 'longitude' || field === 'nav_latitude' || field === 'nav_longitude') {
        return value === null;
      }
      return !hasText(value as string | null);
    }),
  );
  const core = published.filter((row) => row.is_core);
  const coreWithImages = core.filter((row) => row.images.length > 0);
  const coreWithPois = core.filter((row) => row._count.spot_pois >= 3);
  const withImages = published.filter((row) => row.images.length > 0);
  const withPois = published.filter((row) => row._count.spot_pois > 0);
  const banned = published.filter((row) => row.open_status === 'banned');
  const openOrPaused = published.filter(
    (row) => row.open_status === 'open' || row.open_status === 'paused',
  );
  const expired = published.filter((row) => {
    const days = ageDays(row.verified_at);
    const limit = row.is_core ? 30 : 90;
    return days === null || days > limit;
  });

  const gates = {
    published_100: published.length >= 100,
    banned_max_10: banned.length <= 10,
    open_paused_90: openOrPaused.length >= 90,
    core_50: core.length >= 50,
    required_complete: incomplete.length === 0,
    core_images: coreWithImages.length === core.length && core.length > 0,
    core_pois: coreWithPois.length === core.length && core.length > 0,
    freshness: expired.length === 0,
  };
  const report = {
    generated_at: new Date().toISOString(),
    published: published.length,
    drafts: rows.filter((row) => row.status === 'draft').length,
    offline: rows.filter((row) => row.status === 'offline').length,
    incomplete_required: incomplete.length,
    core: core.length,
    core_with_images: coreWithImages.length,
    core_with_three_pois: coreWithPois.length,
    published_with_images: withImages.length,
    published_with_pois: withPois.length,
    banned: banned.length,
    open_or_paused: openOrPaused.length,
    expired_verification: expired.length,
    gates,
    passed: Object.values(gates).every(Boolean),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (strict && !report.passed) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
