import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ClientConfig {
  map: {
    default_latitude: number;
    default_longitude: number;
    default_zoom: number;
  };
  features: {
    map_tab: boolean;
    search: boolean;
    banned_spots: boolean;
  };
  data_freshness: {
    core_days: number;
    normal_days: number;
  };
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  map: {
    default_latitude: 22.5431,
    default_longitude: 114.0579,
    default_zoom: 12,
  },
  features: {
    map_tab: true,
    search: true,
    banned_spots: true,
  },
  data_freshness: {
    core_days: 30,
    normal_days: 90,
  },
};

/** Only these keys may influence the public payload (PRD 10.5). */
export const CLIENT_CONFIG_WHITELIST = [
  'map.default_latitude',
  'map.default_longitude',
  'map.default_zoom',
  'features.map_tab',
  'features.search',
  'features.banned_spots',
  'data_freshness.core_days',
  'data_freshness.normal_days',
] as const;

/** Seed rows kept for backwards compatibility as fallback aliases for freshness. */
export const CLIENT_CONFIG_FALLBACK_ALIASES = [
  'core_spot_verify_days',
  'regular_spot_verify_days',
] as const;

type ConfigValues = Map<string, string>;

function readNumber(
  values: ConfigValues,
  key: string,
  minimum: number,
  maximum: number,
  integer: boolean,
): number | undefined {
  const raw = values.get(key);
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function readBoolean(values: ConfigValues, key: string): boolean | undefined {
  const raw = values.get(key)?.trim().toLowerCase();
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return undefined;
}

function readDays(values: ConfigValues, key: string, alias: string): number | undefined {
  return readNumber(values, key, 1, 3650, true) ?? readNumber(values, alias, 1, 3650, true);
}

@Injectable()
export class ClientConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getClientConfig(): Promise<ClientConfig> {
    const rows = await this.prisma.config.findMany({
      where: {
        config_key: {
          in: [...CLIENT_CONFIG_WHITELIST, ...CLIENT_CONFIG_FALLBACK_ALIASES],
        },
      },
      select: { config_key: true, config_value: true },
    });
    const values: ConfigValues = new Map(
      rows.map((row) => [row.config_key, row.config_value]),
    );

    return {
      map: {
        default_latitude:
          readNumber(values, 'map.default_latitude', -90, 90, false) ??
          DEFAULT_CLIENT_CONFIG.map.default_latitude,
        default_longitude:
          readNumber(values, 'map.default_longitude', -180, 180, false) ??
          DEFAULT_CLIENT_CONFIG.map.default_longitude,
        default_zoom:
          readNumber(values, 'map.default_zoom', 1, 20, true) ??
          DEFAULT_CLIENT_CONFIG.map.default_zoom,
      },
      features: {
        map_tab: readBoolean(values, 'features.map_tab') ?? DEFAULT_CLIENT_CONFIG.features.map_tab,
        search: readBoolean(values, 'features.search') ?? DEFAULT_CLIENT_CONFIG.features.search,
        banned_spots:
          readBoolean(values, 'features.banned_spots') ??
          DEFAULT_CLIENT_CONFIG.features.banned_spots,
      },
      data_freshness: {
        core_days:
          readDays(values, 'data_freshness.core_days', 'core_spot_verify_days') ??
          DEFAULT_CLIENT_CONFIG.data_freshness.core_days,
        normal_days:
          readDays(values, 'data_freshness.normal_days', 'regular_spot_verify_days') ??
          DEFAULT_CLIENT_CONFIG.data_freshness.normal_days,
      },
    };
  }
}
