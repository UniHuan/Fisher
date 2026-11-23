import type { components } from '@szfisher/api-client';
import {
  getAccessToken,
  getRefreshToken,
  refreshSession as refreshStoredSession,
} from './session';

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
export const CLIENT_VERSION = '1.1.0';

export type PublicSpotListItem = components['schemas']['PublicSpotListItemDto'];
export type PublicSpotPage = components['schemas']['PublicSpotPageDto'];
export type PublicSpotDetail = components['schemas']['PublicSpotDetailDto'];
export type PublicMapResponse = components['schemas']['PublicMapResponseDto'];
export type PublicMapItem = components['schemas']['PublicMapItemDto'];
export type PublicMapCluster = components['schemas']['PublicMapClusterDto'];
export type PublicPoiItem = components['schemas']['PublicPoiItemDto'];
export type PublicPoiList = components['schemas']['PublicPoiListDto'];
export type PublicDictionaries = components['schemas']['PublicDictionariesDto'];
export type AppSession = components['schemas']['AppSessionDto'];
export type AppMe = components['schemas']['AppMeDto'];
export type AppNotice = components['schemas']['AppNoticeDto'];
export type AppUser = components['schemas']['AppUserDto'];
export type ClientConfig = components['schemas']['ClientConfigDto'];
export type LegalConfig = components['schemas']['LegalConfigDto'];
export type CreateReportInput = components['schemas']['CreateReportDto'];
export type CreateReportResult = components['schemas']['CreateReportResponseDto'];
export type PublicReportItem = components['schemas']['PublicReportItemDto'];
export type PublicReportPage = components['schemas']['PublicReportPageDto'];
export type MyReportItem = components['schemas']['MyReportItemDto'];
export type MyReportPage = components['schemas']['MyReportPageDto'];
export type UploadUgcImageResult = components['schemas']['UploadUgcResponseDto'];
export type UploadFeedbackImageResult =
  components['schemas']['UploadFeedbackImageResponseDto'];
export type CreateFeedbackInput = components['schemas']['CreateFeedbackDto'];
export type CreateFeedbackResult = components['schemas']['CreateFeedbackResponseDto'];
export type ReportLikeResult = components['schemas']['ReportLikeResponseDto'];
export type AbuseReportResult = components['schemas']['AbuseReportResponseDto'];
export type DeleteReportResult = components['schemas']['DeleteReportResponseDto'];
export type ProductCard = components['schemas']['ProductCardDto'];
export type ProductCardList = components['schemas']['ProductCardListDto'];
export type ProductChannelCard = components['schemas']['ProductChannelCardDto'];
export type PurchaseAction = components['schemas']['PurchaseActionDto'];
export type ProductCategory = ProductCard['category'];
export type ProductQuerySurface = 'spot_detail' | 'brand_page' | 'home' | 'report_detail';
export type ReportContentType = 'comment' | 'catch' | 'intel' | 'condition';
export type MyReportStatusFilter = 'all' | 'pending' | 'published' | 'rejected' | 'removed';
export type AbuseReason = 'ad' | 'abuse' | 'false_info' | 'privacy' | 'other';

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

export interface SpotReportParams {
  content_type?: ReportContentType;
  cursor?: string;
  limit?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  /**
   * 'optional' attaches the access token when one exists and refreshes on 401;
   * 'required' behaves the same and is used by endpoints that need a user.
   */
  auth?: 'optional' | 'required';
}

export interface ProductCardQuery {
  surface: ProductQuerySurface;
  target_id?: string;
  fish_keys?: string;
  category?: ProductCategory;
  limit?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(message: string, status: number, code: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** ERROR_CODES.FORBIDDEN: the account is banned or deleted. */
const ACCOUNT_FORBIDDEN_CODE = 40301;

/**
 * Ban and deletion reject login with 40301. Show the fixed restriction copy
 * without the server reason; network and WeChat failures keep the retry copy.
 */
export function loginFailureText(error: unknown): string {
  return error instanceof ApiError && error.code === ACCOUNT_FORBIDDEN_CODE
    ? '账号已被限制发布'
    : '登录失败，请重试';
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

function sendOnce<T>(path: string, options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const token = options.auth === undefined ? null : getAccessToken();
    const header: Record<string, string> = {
      'X-Client-Type': 'miniprogram',
      'X-Client-Version': CLIENT_VERSION,
      'X-Request-Id': `wx-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    };
    if (token !== null) {
      header.Authorization = `Bearer ${token}`;
    }
    const requestOptions: WxRequestOptions = {
      url: `${API_BASE}${path}${queryString(options.query ?? {})}`,
      method: options.method ?? 'GET',
      timeout: 15000,
      header,
      success: (response) => {
        const body = response.data as Partial<ApiEnvelope<T>> | null;
        if (
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body !== null &&
          body.code === 0
        ) {
          resolve(body.data as T);
          return;
        }
        reject(
          new ApiError(
            body?.message || `请求失败 (${response.statusCode})`,
            response.statusCode,
            body?.code ?? 0,
          ),
        );
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '网络请求失败'));
      },
    };
    if (options.body !== undefined) {
      requestOptions.data = options.body;
    }
    wx.request(requestOptions);
  });
}

async function send<T>(
  path: string,
  options: RequestOptions,
  allowRefresh: boolean,
): Promise<T> {
  try {
    return await sendOnce<T>(path, options);
  } catch (error) {
    if (
      allowRefresh &&
      options.auth !== undefined &&
      error instanceof ApiError &&
      error.status === 401 &&
      getRefreshToken() !== null
    ) {
      try {
        await refreshStoredSession();
      } catch {
        throw error;
      }
      return send<T>(path, options, false);
    }
    throw error;
  }
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, options, true);
}

export function listSpots(params: SpotListParams): Promise<PublicSpotPage> {
  return request<PublicSpotPage>('/spots', { query: params as Record<string, unknown> });
}

export function getSpot(spotId: string): Promise<PublicSpotDetail> {
  return request<PublicSpotDetail>(`/spots/${encodeURIComponent(spotId)}`);
}

export function getMapSpots(params: MapBounds): Promise<PublicMapResponse> {
  return request<PublicMapResponse>('/spots/map', {
    query: params as Record<string, unknown>,
  });
}

export function getDictionaries(): Promise<PublicDictionaries> {
  return request<PublicDictionaries>('/dictionaries');
}

export function getSpotPois(spotId: string, poiType?: string): Promise<PublicPoiList> {
  return request<PublicPoiList>(`/spots/${encodeURIComponent(spotId)}/pois`, {
    query: { poi_type: poiType },
  });
}

export function getClientConfig(): Promise<ClientConfig> {
  return request<ClientConfig>('/config');
}

export function fetchProductCards(query: ProductCardQuery): Promise<ProductCardList> {
  return request<ProductCardList>('/products', {
    query: {
      surface: query.surface,
      target_id: query.target_id,
      fish_keys: query.fish_keys,
      category: query.category,
      limit: query.limit,
    },
  });
}

export function loginWithWechat(code: string): Promise<AppSession> {
  return request<AppSession>('/auth/wechat/login', {
    method: 'POST',
    body: { code },
  });
}

export function refreshSession(refreshToken: string): Promise<AppSession> {
  return request<AppSession>('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

export function logout(refreshToken: string): Promise<null> {
  return request<null>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: 'required',
  });
}

export function getMe(): Promise<AppMe> {
  return request<AppMe>('/auth/me', { auth: 'required' });
}

export function listSpotReports(
  spotId: string,
  params: SpotReportParams = {},
): Promise<PublicReportPage> {
  return request<PublicReportPage>(`/spots/${encodeURIComponent(spotId)}/reports`, {
    query: params as Record<string, unknown>,
    auth: 'optional',
  });
}

export function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  return request<CreateReportResult>('/reports', {
    method: 'POST',
    body: input,
    auth: 'required',
  });
}

export function listMyReports(
  status: MyReportStatusFilter = 'all',
  cursor?: string,
  limit?: number,
): Promise<MyReportPage> {
  return request<MyReportPage>('/reports/mine', {
    query: { status, cursor, limit },
    auth: 'required',
  });
}

export function likeReport(reportId: string): Promise<ReportLikeResult> {
  return request<ReportLikeResult>(`/reports/${encodeURIComponent(reportId)}/like`, {
    method: 'POST',
    auth: 'required',
  });
}

export function unlikeReport(reportId: string): Promise<ReportLikeResult> {
  return request<ReportLikeResult>(`/reports/${encodeURIComponent(reportId)}/like`, {
    method: 'DELETE',
    auth: 'required',
  });
}

export function abuseReport(
  reportId: string,
  reason: AbuseReason,
): Promise<AbuseReportResult> {
  return request<AbuseReportResult>(`/reports/${encodeURIComponent(reportId)}/abuse`, {
    method: 'POST',
    body: { reason },
    auth: 'required',
  });
}

export function deleteReport(reportId: string): Promise<DeleteReportResult> {
  return request<DeleteReportResult>(`/reports/${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
    auth: 'required',
  });
}

function parseUploadEnvelope<T>(raw: string): Partial<ApiEnvelope<T>> | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<ApiEnvelope<T>>;
  } catch {
    return null;
  }
}

function uploadFileOnce<T>(
  endpoint: string,
  filePath: string,
  onProgress?: (progress: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const header: Record<string, string> = {
      'X-Client-Type': 'miniprogram',
      'X-Client-Version': CLIENT_VERSION,
      'X-Request-Id': `wx-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    };
    const token = getAccessToken();
    if (token !== null) {
      header.Authorization = `Bearer ${token}`;
    }
    const task = wx.uploadFile({
      url: `${API_BASE}${endpoint}`,
      filePath,
      name: 'file',
      timeout: 30000,
      header,
      success: (response) => {
        const body = parseUploadEnvelope<T>(response.data);
        if (
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body !== null &&
          body.code === 0 &&
          body.data !== undefined
        ) {
          resolve(body.data);
          return;
        }
        reject(
          new ApiError(
            body?.message || `上传失败 (${response.statusCode})`,
            response.statusCode,
            body?.code ?? 0,
          ),
        );
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '图片上传失败'));
      },
    });
    if (onProgress !== undefined) {
      task.onProgressUpdate((result) => {
        onProgress(Math.max(0, Math.min(100, Math.round(result.progress))));
      });
    }
  });
}

async function uploadWithRefresh<T>(
  endpoint: string,
  filePath: string,
  onProgress?: (progress: number) => void,
): Promise<T> {
  try {
    return await uploadFileOnce<T>(endpoint, filePath, onProgress);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      getRefreshToken() !== null
    ) {
      try {
        await refreshStoredSession();
      } catch {
        throw error;
      }
      return uploadFileOnce<T>(endpoint, filePath, onProgress);
    }
    throw error;
  }
}

/** Uploads one report image and returns the work-bucket key to submit later. */
export function uploadUgcImage(
  filePath: string,
  onProgress?: (progress: number) => void,
): Promise<UploadUgcImageResult> {
  return uploadWithRefresh<UploadUgcImageResult>('/uploads/ugc', filePath, onProgress);
}

/** Uploads one private feedback image and returns its key to attach later. */
export function uploadFeedbackImage(
  filePath: string,
  onProgress?: (progress: number) => void,
): Promise<UploadFeedbackImageResult> {
  return uploadWithRefresh<UploadFeedbackImageResult>(
    '/feedback/images',
    filePath,
    onProgress,
  );
}

export function createFeedback(
  input: CreateFeedbackInput,
): Promise<CreateFeedbackResult> {
  return request<CreateFeedbackResult>('/feedback', {
    method: 'POST',
    body: input,
    auth: 'required',
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

export function contentTypeLabel(contentType: string): string {
  if (contentType === 'catch') {
    return '鱼获';
  }
  if (contentType === 'intel') {
    return '情报';
  }
  if (contentType === 'condition') {
    return '现场';
  }
  return '评论';
}

export function moderationStatusLabel(status: string): string {
  if (status === 'machine_pending') {
    return '审核中';
  }
  if (status === 'published' || status === 'human_approved') {
    return '已发布';
  }
  if (status === 'machine_rejected' || status === 'human_rejected') {
    return '已驳回';
  }
  if (status === 'removed') {
    return '已下架';
  }
  return '未知状态';
}

export function moderationStatusTone(status: string): string {
  if (status === 'machine_pending') {
    return 'tag-warn';
  }
  if (status === 'machine_rejected' || status === 'human_rejected' || status === 'removed') {
    return 'tag-danger';
  }
  return '';
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function relativeTimeText(value: string, now: number = Date.now()): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return '';
  }
  const diff = Math.max(0, now - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return '刚刚';
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)} 天前`;
  }
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function restrictionDateText(value: string | null): string {
  if (value === null || value.length === 0) {
    return '';
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return '';
  }
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
