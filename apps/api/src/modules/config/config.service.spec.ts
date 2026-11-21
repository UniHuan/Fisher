import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClientConfigService, DEFAULT_LEGAL_BASE_URL } from './config.service';

function createService(
  values: Record<string, string | undefined>,
  configRows: Array<{ config_key: string; config_value: string }> = [],
): ClientConfigService {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  const prisma = {
    config: { findMany: jest.fn().mockResolvedValue(configRows) },
  } as unknown as PrismaService;
  return new ClientConfigService(prisma, config);
}

const DEFAULT_LEGAL = {
  terms_version: '',
  terms_url: `${DEFAULT_LEGAL_BASE_URL}/terms`,
  privacy_url: `${DEFAULT_LEGAL_BASE_URL}/privacy`,
  community_url: `${DEFAULT_LEGAL_BASE_URL}/community`,
};

describe('ClientConfigService features.shop', () => {
  it('defaults features.shop to false when the config row is absent', async () => {
    const service = createService({});

    const result = await service.getClientConfig();

    expect(result.features.shop).toBe(false);
  });

  it('returns true when the config row is true', async () => {
    const service = createService({}, [
      { config_key: 'features.shop', config_value: 'true' },
    ]);

    const result = await service.getClientConfig();

    expect(result.features.shop).toBe(true);
  });
});

describe('ClientConfigService legal config', () => {
  const fallbackCases: Array<[string, string | undefined, string | undefined]> = [
    ['absent', undefined, undefined],
    ['empty', '', ''],
    ['whitespace-only', '   ', '   '],
  ];

  it.each(fallbackCases)(
    'falls back to legal defaults when values are %s',
    async (_label, base, version) => {
      const service = createService({
        LEGAL_BASE_URL: base,
        UGC_TERMS_VERSION: version,
      });

      const result = await service.getClientConfig();

      expect(result.legal).toEqual(DEFAULT_LEGAL);
    },
  );

  it('trims configured values and drops trailing slashes from the base URL', async () => {
    const service = createService({
      LEGAL_BASE_URL: '  https://legal.szfisher.test/base//  ',
      UGC_TERMS_VERSION: ' 2026-12-01 ',
    });

    const result = await service.getClientConfig();

    expect(result.legal).toEqual({
      terms_version: '2026-12-01',
      terms_url: 'https://legal.szfisher.test/base/terms',
      privacy_url: 'https://legal.szfisher.test/base/privacy',
      community_url: 'https://legal.szfisher.test/base/community',
    });
  });
});
