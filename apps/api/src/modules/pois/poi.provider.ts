import type { ProviderPoiResult } from './poi.types';

export const POI_PROVIDER = Symbol('POI_PROVIDER');

export interface ProviderSearchInput {
  latitude: string;
  longitude: string;
  radiusM: number;
  maxPerType: number;
}

export interface PoiProvider {
  searchNearby(input: ProviderSearchInput): Promise<ProviderPoiResult>;
}
