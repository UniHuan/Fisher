import { PrismaClient } from '@prisma/client';
import {
  isProductionSeedingAllowed,
  seedAdmin,
  seedConfigs,
  seedDictionaries,
} from '../prisma/seed';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;

const prisma = new PrismaClient();

const DICTIONARY_WHERE = { dict_type: 'poi_type', dict_key: 'food' } as const;
const CONFIG_KEY = 'poi_sync_radius_m';

describe('seed', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps operator edits to dictionaries and configs on re-run', async () => {
    const dictionary = await prisma.dictionary.findUnique({
      where: { dict_type_dict_key: DICTIONARY_WHERE },
    });
    const config = await prisma.config.findUnique({ where: { config_key: CONFIG_KEY } });
    if (!dictionary || !config) {
      throw new Error('seed fixture rows are missing');
    }

    try {
      await prisma.dictionary.update({
        where: { dict_type_dict_key: DICTIONARY_WHERE },
        data: { dict_label: '运营编辑餐饮', sort_order: 99, enabled: false },
      });
      await prisma.config.update({
        where: { config_key: CONFIG_KEY },
        data: { config_value: '9999', description: '运营编辑配置' },
      });

      await seedDictionaries(prisma);
      await seedConfigs(prisma);
      await seedDictionaries(prisma);
      await seedConfigs(prisma);

      await expect(
        prisma.dictionary.findUnique({ where: { dict_type_dict_key: DICTIONARY_WHERE } }),
      ).resolves.toMatchObject({ dict_label: '运营编辑餐饮', sort_order: 99, enabled: false });
      await expect(
        prisma.config.findUnique({ where: { config_key: CONFIG_KEY } }),
      ).resolves.toMatchObject({ config_value: '9999', description: '运营编辑配置' });
    } finally {
      await prisma.dictionary.update({
        where: { dict_type_dict_key: DICTIONARY_WHERE },
        data: {
          dict_label: dictionary.dict_label,
          sort_order: dictionary.sort_order,
          enabled: dictionary.enabled,
        },
      });
      await prisma.config.update({
        where: { config_key: CONFIG_KEY },
        data: { config_value: config.config_value, description: config.description },
      });
    }
  });

  it('still creates missing dictionary and config rows', async () => {
    await prisma.dictionary.delete({
      where: { dict_type_dict_key: { dict_type: 'poi_type', dict_key: 'lodging' } },
    });
    await prisma.config.delete({ where: { config_key: 'analytics_event_retention_days' } });

    await seedDictionaries(prisma);
    await seedConfigs(prisma);

    await expect(
      prisma.dictionary.findUnique({
        where: { dict_type_dict_key: { dict_type: 'poi_type', dict_key: 'lodging' } },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.config.findUnique({ where: { config_key: 'analytics_event_retention_days' } }),
    ).resolves.not.toBeNull();
  });

  it('keeps the district count at ten on re-run', async () => {
    await seedDictionaries(prisma);
    await expect(prisma.dictionary.count({ where: { dict_type: 'district' } })).resolves.toBe(10);
  });

  it('requires a 12 character admin password before hashing', async () => {
    await expect(
      seedAdmin(prisma, {
        NODE_ENV: 'local',
        SEED_ADMIN_USERNAME: 'seed-test-admin',
        SEED_ADMIN_PASSWORD: 'short',
      }),
    ).rejects.toThrow('SEED_ADMIN_PASSWORD must be at least 12 characters');
  });

  it('refuses production seeding unless explicitly allowed', () => {
    expect(isProductionSeedingAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(
      isProductionSeedingAllowed({ NODE_ENV: 'production', SEED_ALLOW_PRODUCTION: 'true' }),
    ).toBe(true);
    expect(isProductionSeedingAllowed({ NODE_ENV: 'local' })).toBe(true);
    expect(isProductionSeedingAllowed({ NODE_ENV: 'staging' })).toBe(true);
  });
});
