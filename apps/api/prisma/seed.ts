import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { ulid } from 'ulid';

interface DictionaryEntry {
  dict_key: string;
  dict_label: string;
}

interface ConfigEntry {
  config_key: string;
  config_value: string;
  description: string;
}

const DISTRICTS: DictionaryEntry[] = [
  { dict_key: '福田区', dict_label: '福田区' },
  { dict_key: '罗湖区', dict_label: '罗湖区' },
  { dict_key: '南山区', dict_label: '南山区' },
  { dict_key: '盐田区', dict_label: '盐田区' },
  { dict_key: '宝安区', dict_label: '宝安区' },
  { dict_key: '龙岗区', dict_label: '龙岗区' },
  { dict_key: '龙华区', dict_label: '龙华区' },
  { dict_key: '坪山区', dict_label: '坪山区' },
  { dict_key: '光明区', dict_label: '光明区' },
  { dict_key: '大鹏新区', dict_label: '大鹏新区' },
];

const FISH_TYPES: DictionaryEntry[] = [
  { dict_key: 'luofei', dict_label: '罗非' },
  { dict_key: 'jiyu', dict_label: '鲫鱼' },
  { dict_key: 'liyu', dict_label: '鲤鱼' },
  { dict_key: 'caoyu', dict_label: '草鱼' },
  { dict_key: 'lianyong', dict_label: '鲢鳙' },
  { dict_key: 'luyu', dict_label: '鲈鱼' },
  { dict_key: 'heiyu', dict_label: '黑鱼' },
  { dict_key: 'nianyu', dict_label: '鲶鱼' },
  { dict_key: 'huangsangyu', dict_label: '黄颡鱼' },
  { dict_key: 'makou', dict_label: '马口' },
  { dict_key: 'qiaozui', dict_label: '翘嘴' },
  { dict_key: 'hailu', dict_label: '海鲈' },
  { dict_key: 'heidiao', dict_label: '黑鲷' },
  { dict_key: 'shiban', dict_label: '石斑' },
  { dict_key: 'nimeng', dict_label: '泥猛' },
  { dict_key: 'wutou', dict_label: '乌头' },
  { dict_key: 'jingu', dict_label: '金鼓' },
  { dict_key: 'qita', dict_label: '其他' },
];

const WATER_TYPES: DictionaryEntry[] = [
  { dict_key: 'reservoir', dict_label: '水库' },
  { dict_key: 'river', dict_label: '河流' },
  { dict_key: 'lake', dict_label: '湖泊' },
  { dict_key: 'sea', dict_label: '海域' },
  { dict_key: 'wetland', dict_label: '湿地' },
  { dict_key: 'pond', dict_label: '池塘' },
  { dict_key: 'other', dict_label: '其他' },
];

const VENUE_TYPES: DictionaryEntry[] = [
  { dict_key: 'wild', dict_label: '野钓' },
  { dict_key: 'paid_fishery', dict_label: '收费钓场' },
  { dict_key: 'black_pit', dict_label: '黑坑' },
  { dict_key: 'weight_pond', dict_label: '斤塘' },
  { dict_key: 'park', dict_label: '公园水域' },
  { dict_key: 'other', dict_label: '其他' },
];

const POI_TYPES: DictionaryEntry[] = [
  { dict_key: 'food', dict_label: '餐饮' },
  { dict_key: 'parking', dict_label: '停车' },
  { dict_key: 'toilet', dict_label: '厕所' },
  { dict_key: 'supply', dict_label: '补给' },
  { dict_key: 'entertainment', dict_label: '娱乐' },
  { dict_key: 'lodging', dict_label: '住宿' },
];

const FISHING_METHODS: DictionaryEntry[] = [
  { dict_key: 'tai_diao', dict_label: '台钓' },
  { dict_key: 'lu_ya', dict_label: '路亚' },
  { dict_key: 'hai_gan', dict_label: '海竿' },
  { dict_key: 'shou_gan', dict_label: '手竿' },
  { dict_key: 'ji_diao', dict_label: '矶钓' },
  { dict_key: 'fa_diao', dict_label: '筏钓' },
];

const FEE_STATUSES: DictionaryEntry[] = [
  { dict_key: 'free', dict_label: '免费' },
  { dict_key: 'paid', dict_label: '收费' },
  { dict_key: 'member', dict_label: '需会员' },
];

const FEE_UNITS: DictionaryEntry[] = [
  { dict_key: 'day', dict_label: '按天' },
  { dict_key: 'hour', dict_label: '按小时' },
  { dict_key: 'rod', dict_label: '按竿' },
  { dict_key: 'year', dict_label: '按年' },
  { dict_key: 'other', dict_label: '其他' },
];

const DICTIONARY_GROUPS: Array<{ dict_type: string; entries: DictionaryEntry[] }> = [
  { dict_type: 'district', entries: DISTRICTS },
  { dict_type: 'fish_type', entries: FISH_TYPES },
  { dict_type: 'water_type', entries: WATER_TYPES },
  { dict_type: 'venue_type', entries: VENUE_TYPES },
  { dict_type: 'poi_type', entries: POI_TYPES },
  { dict_type: 'fishing_method', entries: FISHING_METHODS },
  { dict_type: 'fee_status', entries: FEE_STATUSES },
  { dict_type: 'fee_unit', entries: FEE_UNITS },
];

const DEFAULT_CONFIGS: ConfigEntry[] = [
  { config_key: 'poi_sync_radius_m', config_value: '3000', description: 'POI 同步搜索半径（米）' },
  { config_key: 'poi_sync_max_per_type', config_value: '50', description: '每个钓点每类 POI 保留上限' },
  { config_key: 'spot_duplicate_distance_m', config_value: '200', description: '重复钓点判定距离（米）' },
  { config_key: 'core_spot_verify_days', config_value: '30', description: '核心钓点核实周期（天）' },
  { config_key: 'regular_spot_verify_days', config_value: '90', description: '普通钓点核实周期（天）' },
  { config_key: 'idempotency_key_ttl_hours', config_value: '24', description: '幂等键保留时长（小时）' },
  { config_key: 'analytics_event_retention_days', config_value: '180', description: '埋点明细保留时长（天）' },
  { config_key: 'features.ugc', config_value: 'false', description: 'V1.1 钓友情报开关' },
];

export async function seedDictionaries(prisma: PrismaClient): Promise<void> {
  for (const group of DICTIONARY_GROUPS) {
    for (const [index, entry] of group.entries.entries()) {
      const sort_order = index + 1;
      await prisma.dictionary.upsert({
        where: {
          dict_type_dict_key: { dict_type: group.dict_type, dict_key: entry.dict_key },
        },
        create: {
          dict_type: group.dict_type,
          dict_key: entry.dict_key,
          dict_label: entry.dict_label,
          sort_order,
          enabled: true,
        },
        // Create-only: operators may edit dictionary labels, order and visibility (PRD 8.7).
        update: {},
      });
    }
  }
}

export async function seedConfigs(prisma: PrismaClient): Promise<void> {
  for (const entry of DEFAULT_CONFIGS) {
    await prisma.config.upsert({
      where: { config_key: entry.config_key },
      create: entry,
      // Create-only so operator edits to config values survive a re-run.
      update: {},
    });
  }
}

export function isProductionSeedingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.SEED_ALLOW_PRODUCTION === 'true';
}

export async function seedAdmin(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const nodeEnv = env.NODE_ENV;
  const username = env.SEED_ADMIN_USERNAME;
  const password = env.SEED_ADMIN_PASSWORD;

  if ((nodeEnv !== 'local' && nodeEnv !== 'staging') || !username || !password) {
    return;
  }

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  }

  const password_hash = await hash(password, { type: argon2id });
  await prisma.adminUser.upsert({
    where: { username },
    create: {
      admin_id: ulid(),
      username,
      password_hash,
      role: 'super_admin',
      status: 'active',
    },
    update: {
      password_hash,
      role: 'super_admin',
      status: 'active',
    },
  });
}

async function main(): Promise<void> {
  // Dictionary and config edits belong to operators (PRD 8.7), so production seeding is opt-in.
  if (!isProductionSeedingAllowed()) {
    throw new Error(
      'Refusing to seed in NODE_ENV=production; set SEED_ALLOW_PRODUCTION=true to override',
    );
  }
  const prisma = new PrismaClient();
  try {
    await seedDictionaries(prisma);
    await seedConfigs(prisma);
    await seedAdmin(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
