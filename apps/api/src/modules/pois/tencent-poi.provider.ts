import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POI_TYPE, isShenzhenCoordinate } from '@szfisher/shared';
import type { PoiProvider, ProviderSearchInput } from './poi.provider';
import type { ProviderPoiItem, ProviderPoiResult } from './poi.types';

const TENCENT_SEARCH_URL = 'https://apis.map.qq.com/ws/place/v1/search';
const REQUEST_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 20;
// Tencent keys enforce a per-second request limit. A sync calls six POI types
// in a row, so space the requests instead of hitting the per-key QPS ceiling.
const REQUEST_INTERVAL_MS = 350;

const TYPE_KEYWORDS: ReadonlyArray<{ type: string; keyword: string }> = [
  { type: POI_TYPE.FOOD, keyword: '美食' },
  { type: POI_TYPE.PARKING, keyword: '停车场' },
  { type: POI_TYPE.TOILET, keyword: '公共厕所' },
  { type: POI_TYPE.SUPPLY, keyword: '超市' },
  { type: POI_TYPE.ENTERTAINMENT, keyword: '公园' },
  { type: POI_TYPE.LODGING, keyword: '酒店' },
];

interface TencentLocation {
  lat?: number;
  lng?: number;
}

interface TencentPoi {
  id?: string;
  title?: string;
  address?: string;
  location?: TencentLocation;
}

interface TencentResponse {
  status?: number;
  message?: string;
  data?: TencentPoi[];
}

/**
 * Tencent Location Service adapter. The provider is deliberately thin: it maps
 * external rows to our POI fields and never writes to the database.
 */
@Injectable()
export class TencentPoiProvider implements PoiProvider {
  private lastRequestAt = 0;

  constructor(private readonly config: ConfigService) {}

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = this.lastRequestAt + REQUEST_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
  }

  async searchNearby(input: ProviderSearchInput): Promise<ProviderPoiResult> {
    const key = this.config.get<string>('TENCENT_MAP_SERVER_KEY');
    if (key === undefined || key.trim().length === 0) {
      throw new Error('TENCENT_MAP_SERVER_KEY is not configured');
    }

    const seen = new Set<string>();
    const items: ProviderPoiItem[] = [];
    let quotaUsed = 0;
    for (const { type, keyword } of TYPE_KEYWORDS) {
      const rows = await this.searchType(input, keyword, key);
      quotaUsed += 1;
      let accepted = 0;
      for (const row of rows) {
        if (accepted >= input.maxPerType) {
          break;
        }
        const externalId = row.id?.trim();
        const name = row.title?.trim();
        const latitude = row.location?.lat;
        const longitude = row.location?.lng;
        if (
          externalId === undefined ||
          externalId.length === 0 ||
          externalId.length > 64 ||
          name === undefined ||
          name.length === 0 ||
          name.length > 80 ||
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          !isShenzhenCoordinate(latitude, longitude) ||
          seen.has(externalId)
        ) {
          continue;
        }
        seen.add(externalId);
        accepted += 1;
        items.push({
          external_poi_id: externalId,
          poi_name: name,
          poi_type: type,
          latitude: latitude.toFixed(6),
          longitude: longitude.toFixed(6),
          address:
            row.address === undefined || row.address.trim().length === 0
              ? null
              : row.address.trim().slice(0, 120),
          rating: null,
          open_time: null,
        });
      }
    }
    return { items, quotaUsed };
  }

  private async searchType(
    input: ProviderSearchInput,
    keyword: string,
    key: string,
  ): Promise<TencentPoi[]> {
    const query = new URLSearchParams({
      boundary: `nearby(${input.latitude},${input.longitude},${input.radiusM},0)`,
      keyword,
      page_size: String(PAGE_SIZE),
      page_index: '1',
      key,
      output: 'json',
    });
    await this.waitForRequestSlot();
    const response = await fetch(`${TENCENT_SEARCH_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Tencent POI search failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as TencentResponse;
    if (payload.status !== 0) {
      const message =
        payload.message === undefined || payload.message.trim().length === 0
          ? 'unknown error'
          : payload.message.trim();
      throw new Error(`Tencent POI search failed: ${message.slice(0, 200)}`);
    }
    return Array.isArray(payload.data) ? payload.data : [];
  }
}
