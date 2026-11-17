import type { components } from '@szfisher/api-client';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const CLIENT_VERSION = '1.0.0';

export type AdminProfile = components['schemas']['AdminProfileDto'];
export type AdminSession = components['schemas']['AdminSessionDto'];
export type AdminSpotDetail = components['schemas']['AdminSpotDetailDto'];
export type AdminSpotListItem = components['schemas']['AdminSpotListItemDto'];
export type AdminSpotPage = components['schemas']['AdminSpotPageDto'];
export type AdminSpotWrite = components['schemas']['AdminSpotWriteResponseDto'];
export type DuplicateWarning = components['schemas']['DuplicateWarningDto'];
export type UploadResponse = components['schemas']['UploadImageResponseDto'];
export type PublicDictionaries = components['schemas']['PublicDictionariesDto'];
export type CreateSpotBody = components['schemas']['CreateSpotDto'];
export type UpdateSpotBody = components['schemas']['UpdateSpotDto'];
export type TotpSetup = components['schemas']['TotpSetupDto'];
export type TotpEnable = components['schemas']['TotpEnableDto'];
export type LoginResponse =
  | components['schemas']['AdminSessionDto']
  | components['schemas']['LoginMfaRequiredDto']
  | components['schemas']['LoginMustBindTotpDto'];

export interface Session {
  admin: AdminProfile;
  csrf: string;
}

export interface SpotListQuery {
  status?: string;
  district?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}

interface ErrorEnvelope {
  code?: number;
  message?: string;
  details?: Array<{ field: string; message: string }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  csrf?: string;
  headers?: Record<string, string>;
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Client-Type': 'admin',
    'X-Client-Version': CLIENT_VERSION,
    ...(options.csrf === undefined ? {} : { 'X-CSRF-Token': options.csrf }),
    ...(options.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
  } & ErrorEnvelope;
  if (!response.ok) {
    throw new ApiError(
      payload.message ?? `请求失败 (${response.status})`,
      payload.code,
      payload.details,
    );
  }
  return payload.data as T;
}

export function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined || url.length === 0) {
    return undefined;
  }
  try {
    return new URL(url, API_BASE).toString();
  } catch {
    return undefined;
  }
}

export const api = {
  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },
  refresh(): Promise<AdminSession> {
    return request<AdminSession>('/admin/auth/refresh', { method: 'POST' });
  },
  logout(csrf: string): Promise<null> {
    return request<null>('/admin/auth/logout', { method: 'POST', csrf });
  },
  totpSetup(mfaToken: string): Promise<TotpSetup> {
    return request<TotpSetup>('/admin/auth/totp/setup', {
      method: 'POST',
      body: { mfa_token: mfaToken },
    });
  },
  totpVerify(mfaToken: string, code: string): Promise<AdminSession> {
    return request<AdminSession>('/admin/auth/totp/verify', {
      method: 'POST',
      body: { mfa_token: mfaToken, code },
    });
  },
  totpEnable(mfaToken: string, code: string): Promise<TotpEnable> {
    return request<TotpEnable>('/admin/auth/totp/enable', {
      method: 'POST',
      body: { mfa_token: mfaToken, code },
    });
  },
  dictionaries(): Promise<PublicDictionaries> {
    return request<PublicDictionaries>('/dictionaries');
  },
  listSpots(query: SpotListQuery): Promise<AdminSpotPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    }
    const suffix = params.size === 0 ? '' : `?${params.toString()}`;
    return request<AdminSpotPage>(`/admin/spots${suffix}`);
  },
  getSpot(id: string): Promise<AdminSpotDetail> {
    return request<AdminSpotDetail>(`/admin/spots/${id}`);
  },
  createSpot(body: CreateSpotBody, csrf: string): Promise<AdminSpotWrite> {
    return request<AdminSpotWrite>('/admin/spots', { method: 'POST', body, csrf });
  },
  updateSpot(
    id: string,
    body: UpdateSpotBody,
    csrf: string,
  ): Promise<AdminSpotWrite> {
    return request<AdminSpotWrite>(`/admin/spots/${id}`, {
      method: 'PUT',
      body,
      csrf,
    });
  },
  publishSpot(id: string, csrf: string): Promise<AdminSpotDetail> {
    return request<AdminSpotDetail>(`/admin/spots/${id}/publish`, {
      method: 'POST',
      csrf,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },
  offlineSpot(id: string, csrf: string): Promise<AdminSpotDetail> {
    return request<AdminSpotDetail>(`/admin/spots/${id}/offline`, {
      method: 'POST',
      csrf,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },
  verifySpot(id: string, csrf: string): Promise<AdminSpotDetail> {
    return request<AdminSpotDetail>(`/admin/spots/${id}/verify`, {
      method: 'POST',
      body: {},
      csrf,
    });
  },
  deleteSpot(id: string, csrf: string): Promise<{ deleted: true }> {
    return request<{ deleted: true }>(`/admin/spots/${id}`, {
      method: 'DELETE',
      csrf,
    });
  },
  uploadImage(
    spotId: string,
    purpose: 'cover' | 'detail',
    file: File,
    csrf: string,
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.set('spot_id', spotId);
    formData.set('purpose', purpose);
    formData.set('file', file);
    return request<UploadResponse>('/admin/uploads', {
      method: 'POST',
      formData,
      csrf,
    });
  },
};
