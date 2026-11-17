import { PrismaClient, type Prisma } from '@prisma/client';
import { ulid } from 'ulid';

const countArg = process.argv.find((value) => value.startsWith('--count='));
const prefixArg = process.argv.find((value) => value.startsWith('--prefix='));
const count = countArg === undefined ? 100 : Number(countArg.split('=')[1]);
const prefix = prefixArg === undefined ? 'PERF-' : (prefixArg.split('=')[1] ?? 'PERF-');
const cleanup = process.argv.includes('--cleanup');

if (!Number.isInteger(count) || count < 1 || count > 20_000) {
  throw new Error('--count must be an integer between 1 and 20000');
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required');
}
const parsed = new URL(databaseUrl);
const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  throw new Error('Performance seeding is limited to a local database');
}
if (!/(_perf|_test)$/.test(database)) {
  throw new Error('Performance seeding requires a database ending in _perf or _test');
}

const DISTRICTS = [
  '南山区',
  '福田区',
  '罗湖区',
  '盐田区',
  '宝安区',
  '龙岗区',
  '龙华区',
  '坪山区',
  '光明区',
  '大鹏新区',
];

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (cleanup) {
    const removed = await prisma.spot.deleteMany({
      where: { spot_name: { startsWith: prefix } },
    });
    process.stdout.write(
      `${JSON.stringify({ event: 'perf_seed_cleanup', prefix, removed: removed.count })}\n`,
    );
    return;
  }

  const now = new Date();
  const rows: Prisma.SpotCreateManyInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const district = DISTRICTS[index % DISTRICTS.length] ?? DISTRICTS[0];
    const latitude = 22.45 + (index % 50) * 0.008;
    const longitude = 113.85 + Math.floor(index / 50) * 0.012;
    rows.push({
      spot_id: ulid(),
      spot_name: `${prefix}压测钓点-${String(index + 1).padStart(5, '0')}`,
      city_code: '440300',
      district,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      nav_latitude: latitude.toFixed(6),
      nav_longitude: longitude.toFixed(6),
      address: `深圳市${district}压测路${index + 1}号`,
      fish_types: ['luofei', 'jiyu'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      fishing_method: ['tai_diao'],
      open_status: index % 15 === 0 ? 'paused' : 'open',
      open_hours: '06:00-22:00',
      description: '性能测试合成数据，请勿用于生产',
      tips: '性能测试数据',
      images: [],
      sort_weight: count - index,
      is_core: index < 50,
      status: 'published',
      source: 'operation',
      verified_at: now,
    });
  }
  const created = await prisma.spot.createMany({ data: rows, skipDuplicates: true });
  process.stdout.write(
    `${JSON.stringify({ event: 'perf_seed', prefix, requested: count, created: created.count })}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
