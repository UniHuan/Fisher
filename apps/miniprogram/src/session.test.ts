/// <reference types="jest" />

import * as api from './api';
import * as session from './session';

interface MockWx {
  getAccountInfoSync: jest.Mock;
  login: jest.Mock;
  request: jest.Mock;
  getStorageSync: jest.Mock;
  setStorageSync: jest.Mock;
  removeStorageSync: jest.Mock;
  showModal: jest.Mock;
}

const storage = new Map<string, unknown>();
const loginMock = jest.fn();
const requestMock = jest.fn();

const globalScope = globalThis as unknown as { wx: MockWx };

function installWxMock(): void {
  globalScope.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    login: loginMock,
    request: requestMock,
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      storage.set(key, value);
    },
    removeStorageSync: (key: string) => {
      storage.delete(key);
    },
    showModal: jest.fn(),
  } as MockWx;
}

function envelope(data: unknown): Record<string, unknown> {
  return { code: 0, message: 'ok', data, request_id: 'req-test' };
}

function successResponse(data: unknown): WxResponse {
  return { statusCode: 200, data: envelope(data), header: {} };
}

function errorResponse(statusCode: number, code: number, message: string): WxResponse {
  return {
    statusCode,
    data: { code, message, data: null, request_id: 'req-test' },
    header: {},
  };
}

function sessionPayload(accessToken: string, refreshToken: string): Record<string, unknown> {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 7200,
    user: { nickname: '钓友 A7K2', avatar_url: null },
  };
}

function mePayload(): Record<string, unknown> {
  return {
    user: { nickname: '钓友 A7K2', avatar_url: null },
    can_publish: true,
    restricted_until: null,
    notices: [],
  };
}

function storedSession(): Record<string, unknown> | null {
  const raw = storage.get('szfisher.session');
  if (typeof raw !== 'string') {
    return null;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function requestUrl(options: WxRequestOptions): string {
  return options.url;
}

function authorization(options: WxRequestOptions): string {
  return options.header?.Authorization ?? '';
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  storage.clear();
  loginMock.mockReset();
  requestMock.mockReset();
  installWxMock();
});

describe('session.ensureSession', () => {
  it('logs in once, stores tokens, and reuses them', async () => {
    loginMock.mockImplementation((options: WxLoginOptions) => {
      options.success?.({ code: 'code-1', errMsg: 'login:ok' });
    });
    requestMock.mockImplementation((options: WxRequestOptions) => {
      expect(requestUrl(options)).toContain('/api/v1/auth/wechat/login');
      expect(options.method).toBe('POST');
      expect(options.data).toEqual({ code: 'code-1' });
      options.success?.(successResponse(sessionPayload('access-1', 'refresh-1')));
    });

    const [first, second] = await Promise.all([
      session.ensureSession(),
      session.ensureSession(),
    ]);

    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(first.access_token).toBe('access-1');
    expect(second.access_token).toBe('access-1');
    expect(storedSession()?.access_token).toBe('access-1');
    expect(storedSession()?.refresh_token).toBe('refresh-1');

    const third = await session.ensureSession();
    expect(third.access_token).toBe('access-1');
    expect(loginMock).toHaveBeenCalledTimes(1);
  });
});

describe('session.refreshSession', () => {
  it('refreshes once for two concurrent 401 responses and replays both requests', async () => {
    storage.set(
      'szfisher.session',
      JSON.stringify(sessionPayload('old-access', 'refresh-old')),
    );
    let refreshCalls = 0;
    requestMock.mockImplementation((options: WxRequestOptions) => {
      if (requestUrl(options).includes('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        expect(options.data).toEqual({ refresh_token: 'refresh-old' });
        options.success?.(successResponse(sessionPayload('new-access', 'refresh-new')));
        return;
      }
      expect(requestUrl(options)).toContain('/api/v1/auth/me');
      if (authorization(options) === 'Bearer new-access') {
        options.success?.(successResponse(mePayload()));
        return;
      }
      options.success?.(errorResponse(401, 40102, 'Access token expired'));
    });

    const [first, second] = await Promise.all([api.getMe(), api.getMe()]);

    expect(refreshCalls).toBe(1);
    expect(first.can_publish).toBe(true);
    expect(second.can_publish).toBe(true);
    expect(session.getAccessToken()).toBe('new-access');
    expect(storedSession()?.refresh_token).toBe('refresh-new');
  });

  it('keeps logout final when a refresh resolves after logout starts', async () => {
    storage.set(
      'szfisher.session',
      JSON.stringify(sessionPayload('old-access', 'refresh-old')),
    );
    const refreshCallbacks: Array<(response: WxResponse) => void> = [];
    let logoutData: unknown = null;
    let logoutAuth = '';
    requestMock.mockImplementation((options: WxRequestOptions) => {
      if (requestUrl(options).includes('/api/v1/auth/refresh')) {
        if (options.success !== undefined) {
          refreshCallbacks.push(options.success);
        }
        return;
      }
      if (requestUrl(options).includes('/api/v1/auth/logout')) {
        logoutData = options.data;
        logoutAuth = authorization(options);
        options.success?.(successResponse(null));
        return;
      }
      expect(requestUrl(options)).toContain('/api/v1/auth/me');
      if (authorization(options) === 'Bearer new-access') {
        options.success?.(successResponse(mePayload()));
        return;
      }
      options.success?.(errorResponse(401, 40102, 'Access token expired'));
    });

    const mePromise = api.getMe().catch(() => undefined);
    await flushMicrotasks();
    expect(refreshCallbacks.length).toBe(1);

    // Logout starts while the refresh is still in flight.
    const logoutPromise = session.logout();
    const resolveRefresh = refreshCallbacks[0];
    if (resolveRefresh === undefined) {
      throw new Error('refresh request was not started');
    }
    resolveRefresh(successResponse(sessionPayload('new-access', 'refresh-new')));

    await logoutPromise;
    await mePromise;

    expect(storage.has('szfisher.session')).toBe(false);
    expect(session.getSession()).toBeNull();
    expect(logoutData).toEqual({ refresh_token: 'refresh-new' });
    expect(logoutAuth).toBe('Bearer new-access');
  });

  it('does not restore a session that was cleared while a refresh was in flight', async () => {
    storage.set(
      'szfisher.session',
      JSON.stringify(sessionPayload('old-access', 'refresh-old')),
    );
    const refreshCallbacks: Array<(response: WxResponse) => void> = [];
    requestMock.mockImplementation((options: WxRequestOptions) => {
      if (requestUrl(options).includes('/api/v1/auth/refresh')) {
        if (options.success !== undefined) {
          refreshCallbacks.push(options.success);
        }
        return;
      }
      options.success?.(errorResponse(401, 40102, 'Access token expired'));
    });

    const mePromise = api.getMe().catch(() => undefined);
    await flushMicrotasks();
    expect(refreshCallbacks.length).toBe(1);

    session.clearSession();
    const resolveRefresh = refreshCallbacks[0];
    if (resolveRefresh === undefined) {
      throw new Error('refresh request was not started');
    }
    resolveRefresh(successResponse(sessionPayload('new-access', 'refresh-new')));
    await mePromise;

    expect(storage.has('szfisher.session')).toBe(false);
    expect(session.getSession()).toBeNull();
  });

  it('clears the stored session when the refresh fails', async () => {
    storage.set(
      'szfisher.session',
      JSON.stringify(sessionPayload('old-access', 'refresh-old')),
    );
    requestMock.mockImplementation((options: WxRequestOptions) => {
      if (requestUrl(options).includes('/api/v1/auth/refresh')) {
        options.success?.(errorResponse(401, 40102, 'Invalid refresh token'));
        return;
      }
      options.success?.(errorResponse(401, 40102, 'Access token expired'));
    });

    await expect(api.getMe()).rejects.toThrow();

    expect(storage.has('szfisher.session')).toBe(false);
    expect(session.getSession()).toBeNull();
  });
});
