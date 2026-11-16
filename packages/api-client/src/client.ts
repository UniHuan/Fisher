import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type ClientType = 'miniprogram' | 'ios' | 'admin';

export interface CreateApiClientOptions {
  baseUrl: string;
  clientType?: ClientType;
  clientVersion?: string;
  requestId?: string;
}

/**
 * Typed API client generated from openapi/openapi.yaml.
 * Admin calls carry cookies so the __Host- session works across origins;
 * client apps never send credentials.
 */
export function createApiClient({
  baseUrl,
  clientType = 'miniprogram',
  clientVersion = '1.0.0',
  requestId,
}: CreateApiClientOptions) {
  const headers: Record<string, string> = {
    'X-Client-Type': clientType,
    'X-Client-Version': clientVersion,
  };
  if (requestId !== undefined) {
    headers['X-Request-Id'] = requestId;
  }

  return createClient<paths>({
    baseUrl,
    headers,
    credentials: clientType === 'admin' ? 'include' : 'omit',
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
