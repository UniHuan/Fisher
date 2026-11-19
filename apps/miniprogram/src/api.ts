import type { components } from '@szfisher/api-client';

function resolveApiOrigin(): string {
  // Set to 'http://localhost:3001' to develop against a local API.
  const localOverride = '';
  if (localOverride.length > 0) {
    return localOverride;
  }
  try {
    const envVersion = wx.getAccountInfoSync().miniProgram?.envVersion ?? 'develop';
    return envVersion === 'release'
      ? 'https://fish-api.unihuan.com'
      : 'https://fish-api-staging.unihuan.com';
  } catch {
    return 'https://fish-api-staging.unihuan.com';
  }
}

export const API_ORIGIN = resolveApiOrigin();
export const API_BASE = `${API_ORIGIN}/api/v1`;
export const CLIENT_VERSION = '1.0.0';

export type PublicSpotListItem = components['schemas']['PublicSpotListItemDto'];
export type PublicSpotPage = components['schemas']['PublicSpotPageDto'];
export type PublicSpotDetail = components['schemas']['PublicSpotDetailDto'];
export type PublicMapResponse = components['schemas']['PublicMapResponseDto'];
export type PublicMapItem = components['schemas']['PublicMapItemDto'];
export type PublicMapCluster = components['schemas']['PublicMapClusterDto'];
export type PublicPoiItem = components['schemas']['PublicPoiItemDto'];
export type PublicPoiList = components['schemas']['PublicPoiListDto'];
export type PublicDictionaries = components['schemas']['PublicDictionariesDto'];

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}

export interface SpotListParams {
  district?: string;
  fish_types?: string;
  fee_status?: string;
  water_type?: string;
  venue_type?: string;
  open_status?: string;
  include_banned?: boolean;
  keyword?: string;
  latitude?: number;
  longitude?: number;
  sort?: 'distance' | 'recommended' | 'updated_at';
  page?: number;
  page_size?: number;
}

export interface MapBounds {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  zoom?: number;
  include_banned?: boolean;
}

function queryString(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function request<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}${queryString(params)}`,
      method: 'GET',
      timeout: 15000,
      header: {
        'X-Client-Type': 'miniprogram',
        'X-Client-Version': CLIENT_VERSION,
        'X-Request-Id': `wx-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      },
      success: (response) => {
        const body = response.data as ApiEnvelope<T>;
        if (
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body.code === 0
        ) {
          resolve(body.data);
          return;
        }
        reject(new Error(body.message || `请求失败 (${response.statusCode})`));
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '网络请求失败'));
      },
    });
  });
}

export function listSpots(params: SpotListParams): Promise<PublicSpotPage> {
  return request<PublicSpotPage>('/spots', params as Record<string, unknown>);
}

export function getSpot(spotId: string): Promise<PublicSpotDetail> {
  return request<PublicSpotDetail>(`/spots/${encodeURIComponent(spotId)}`);
}

export function getMapSpots(params: MapBounds): Promise<PublicMapResponse> {
  return request<PublicMapResponse>('/spots/map', params as Record<string, unknown>);
}

export function getDictionaries(): Promise<PublicDictionaries> {
  return request<PublicDictionaries>('/dictionaries');
}

export function getSpotPois(spotId: string, poiType?: string): Promise<PublicPoiList> {
  return request<PublicPoiList>(`/spots/${encodeURIComponent(spotId)}/pois`, {
    poi_type: poiType,
  });
}

export function mediaUrl(url: string | null | undefined): string {
  if (url === null || url === undefined || url.length === 0) {
    return '';
  }
  if (url.indexOf('http') === 0) {
    return url;
  }
  if (url.charAt(0) === '/') {
    return `${API_ORIGIN}${url}`;
  }
  return `${API_ORIGIN}/${url}`;
}

export function distanceText(distance: number | undefined): string {
  if (distance === undefined) {
    return '';
  }
  if (distance < 1000) {
    return `${distance}m`;
  }
  return `${(distance / 1000).toFixed(1)}km`;
}

export function openStatusLabel(status: string): string {
  if (status === 'paused') {
    return '暂停开放';
  }
  if (status === 'banned') {
    return '禁钓';
  }
  return '开放';
}

export function freshnessLabel(freshness: string): string {
  if (freshness === 'expired') {
    return '信息可能已过期';
  }
  if (freshness === 'stale') {
    return '信息可能已变化';
  }
  return '信息较新';
}

export function dictionaryLabel(
  items: Array<{ key: string; label: string }> | undefined,
  key: string | null | undefined,
): string {
  if (key === null || key === undefined) {
    return '';
  }
  const found = (items ?? []).find((item) => item.key === key);
  return found?.label ?? key;
}
