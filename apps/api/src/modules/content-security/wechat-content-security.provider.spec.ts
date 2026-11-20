import type { ConfigService } from '@nestjs/config';
import {
  WechatAccessTokenError,
  WechatAccessTokenService,
} from './wechat-access-token.service';
import { WechatContentSecurityProvider } from './wechat-content-security.provider';

interface TokenStub {
  getAccessToken: jest.Mock;
  invalidate: jest.Mock;
}

function makeProvider(tokens: TokenStub): WechatContentSecurityProvider {
  const config = {
    get: (key: string) =>
      ({
        WECHAT_MSG_TOKEN: 'test-msg-token',
        WECHAT_MSG_AES_KEY: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        WECHAT_MINI_APPID: 'wx-test-appid',
      })[key],
  } as unknown as ConfigService;
  return new WechatContentSecurityProvider(
    tokens as unknown as WechatAccessTokenService,
    config,
  );
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe('WechatContentSecurityProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps a passing response and sends the documented request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        errcode: 0,
        trace_id: 'trace-1',
        result: { suggest: 'pass', label: 100 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const tokens: TokenStub = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidate: jest.fn(),
    };

    const result = await makeProvider(tokens).checkText({ content: 'hello', openid: 'openid-x' });

    expect(result).toEqual({ suggest: 'pass', label: 100, traceId: 'trace-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.weixin.qq.com/wxa/msg_sec_check?access_token=access-token');
    expect(JSON.parse(String(init.body))).toEqual({
      content: 'hello',
      openid: 'openid-x',
      scene: 2,
      version: 2,
    });
  });

  it('records a safe error code when the access token is unavailable', async () => {
    const tokens: TokenStub = {
      getAccessToken: jest
        .fn()
        .mockRejectedValue(new WechatAccessTokenError('token-not-configured')),
      invalidate: jest.fn(),
    };

    const result = await makeProvider(tokens).checkText({ content: 'x', openid: 'y' });

    expect(result).toEqual({ suggest: 'review', errorCode: 'token-not-configured' });
  });

  it('records the errcode after refreshing a stale token once', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const tokens: TokenStub = {
      getAccessToken: jest.fn().mockResolvedValue('stale-token'),
      invalidate: jest.fn(),
    };

    const result = await makeProvider(tokens).checkText({ content: 'x', openid: 'y' });

    expect(result).toEqual({ suggest: 'review', errorCode: 'errcode-40001' });
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('records request-failed when the network call rejects', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const tokens: TokenStub = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidate: jest.fn(),
    };

    const result = await makeProvider(tokens).checkText({ content: 'x', openid: 'y' });

    expect(result).toEqual({ suggest: 'review', errorCode: 'request-failed' });
  });

  it('submits media for asynchronous review and returns the trace id', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ errcode: 0, trace_id: 'media-trace-1' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const tokens: TokenStub = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidate: jest.fn(),
    };

    const result = await makeProvider(tokens).checkMedia({
      imageUrl: 'https://api.example.com/preview?sig=x',
      openid: 'openid-x',
    });

    expect(result).toEqual({ traceId: 'media-trace-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.weixin.qq.com/wxa/media_check_async?access_token=access-token',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      media_url: 'https://api.example.com/preview?sig=x',
      media_type: 2,
      version: 2,
      scene: 2,
      openid: 'openid-x',
    });
  });

  it('throws a safe ContentSecurityMediaError when media submission fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ errcode: 40001 })) as unknown as typeof fetch;
    const tokens: TokenStub = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidate: jest.fn(),
    };

    const provider = makeProvider(tokens);
    await expect(
      provider.checkMedia({ imageUrl: 'https://api.example.com/x', openid: 'openid-x' }),
    ).rejects.toMatchObject({ reason: 'errcode-40001' });
    // One token refresh retry, then the same errcode is surfaced.
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
  });
});
