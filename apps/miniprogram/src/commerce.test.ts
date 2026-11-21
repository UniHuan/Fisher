/// <reference types="jest" />

import * as commerce from './commerce';
import type { ProductCard } from './api';

interface MockWx {
  getAccountInfoSync: jest.Mock;
  getSystemInfoSync: jest.Mock;
  request: jest.Mock;
  getStorageSync: jest.Mock;
  setStorageSync: jest.Mock;
  removeStorageSync: jest.Mock;
  navigateToMiniProgram: jest.Mock;
  setClipboardData: jest.Mock;
  showToast: jest.Mock;
  reportAnalytics: jest.Mock;
}

const requestMock = jest.fn();
const navigateToMiniProgramMock = jest.fn();
const setClipboardDataMock = jest.fn();
const showToastMock = jest.fn();
const reportAnalyticsMock = jest.fn();

const globalScope = globalThis as unknown as { wx: MockWx };

function installWxMock(): void {
  globalScope.wx = {
    getAccountInfoSync: () => ({
      miniProgram: { envVersion: 'develop', version: 'test' },
    }),
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    request: requestMock,
    getStorageSync: () => undefined,
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
    navigateToMiniProgram: navigateToMiniProgramMock,
    setClipboardData: setClipboardDataMock,
    showToast: showToastMock,
    reportAnalytics: reportAnalyticsMock,
  } as unknown as MockWx;
}

function productCard(): ProductCard {
  return {
    product_id: '01HX0000000000000000000001',
    title: 'UniHuan 轻量路亚竿',
    subtitle: '深圳湾岸钓适用',
    category: 'rod',
    image_url:
      '/api/v1/uploads/public/products/01HX0000000000000000000001/01HX0000000000000000000002.webp',
    channels: [
      {
        channel: 'weidian',
        label: '微店',
        price_display: '¥299 起',
        purchase_action: {
          type: 'copy_link',
          url: 'https://weidian.com/item.html?itemID=1',
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  installWxMock();
});

describe('commerce.openPurchaseAction', () => {
  it('opens a mini program purchase action with the app id and path', () => {
    commerce.openPurchaseAction(
      {
        type: 'mini_program',
        app_id: 'wx0123456789abcdef',
        path: '/pages/product/detail?id=1',
      },
      { product_id: 'p-1', channel: 'weidian' },
    );

    expect(navigateToMiniProgramMock).toHaveBeenCalledTimes(1);
    expect(navigateToMiniProgramMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'wx0123456789abcdef',
        path: '/pages/product/detail?id=1',
      }),
    );
    expect(reportAnalyticsMock).toHaveBeenCalledWith(
      'purchase_action_open',
      expect.objectContaining({
        action_type: 'mini_program',
        channel: 'weidian',
        product_id: 'p-1',
      }),
    );
  });

  it('copies fallback_url when the mini program navigation fails', () => {
    navigateToMiniProgramMock.mockImplementation((options: { fail?: () => void }) => {
      options.fail?.();
    });
    setClipboardDataMock.mockImplementation((options: { success?: () => void }) => {
      options.success?.();
    });

    commerce.openPurchaseAction({
      type: 'mini_program',
      app_id: 'wx0123456789abcdef',
      path: '/pages/product/detail?id=1',
      fallback_url: 'https://weidian.com/item.html?itemID=1',
    });

    expect(setClipboardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'https://weidian.com/item.html?itemID=1' }),
    );
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: '链接已复制，请在浏览器打开' }),
    );
  });

  it('tracks purchase_action_fail when navigation fails without a fallback', () => {
    navigateToMiniProgramMock.mockImplementation((options: { fail?: () => void }) => {
      options.fail?.();
    });

    commerce.openPurchaseAction(
      { type: 'mini_program', app_id: 'wx0123456789abcdef', path: '/p' },
      { product_id: 'p-1', channel: 'weidian' },
    );

    expect(setClipboardDataMock).not.toHaveBeenCalled();
    expect(reportAnalyticsMock).toHaveBeenCalledWith(
      'purchase_action_fail',
      expect.objectContaining({
        action_type: 'mini_program',
        channel: 'weidian',
        product_id: 'p-1',
        reason: 'navigate_fail',
      }),
    );
  });

  it('copies a copy_link url and shows its toast', () => {
    setClipboardDataMock.mockImplementation((options: { success?: () => void }) => {
      options.success?.();
    });

    commerce.openPurchaseAction({
      type: 'copy_link',
      url: 'https://weidian.com/item.html?itemID=2',
      toast: '商品链接已复制',
    });

    expect(setClipboardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'https://weidian.com/item.html?itemID=2' }),
    );
    expect(showToastMock).toHaveBeenCalledWith({ title: '商品链接已复制', icon: 'none' });
  });

  it('copies an h5 url and tells the user to open a browser', () => {
    setClipboardDataMock.mockImplementation((options: { success?: () => void }) => {
      options.success?.();
    });

    commerce.openPurchaseAction({
      type: 'h5',
      url: 'https://weidian.com/item.html?itemID=3',
    });

    expect(setClipboardDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'https://weidian.com/item.html?itemID=3' }),
    );
    expect(showToastMock).toHaveBeenCalledWith({
      title: '链接已复制，请在浏览器打开',
      icon: 'none',
    });
  });

  it('does not throw when required purchase fields are missing', () => {
    expect(() => commerce.openPurchaseAction({ type: 'copy_link' })).not.toThrow();
    expect(showToastMock).toHaveBeenCalled();
  });
});

describe('commerce.productCategoryLabel', () => {
  it.each([
    ['rod', '竿'],
    ['reel', '轮'],
    ['line', '线'],
    ['bait', '饵'],
    ['hat', '帽子'],
    ['sun_protection', '防晒'],
    ['accessory', '配件'],
    ['other', '其他'],
  ])('maps %s to %s', (category, label) => {
    expect(commerce.productCategoryLabel(category)).toBe(label);
  });

  it('falls back to 其他 for an unknown category', () => {
    expect(commerce.productCategoryLabel('unknown')).toBe('其他');
  });
});

describe('commerce.fishKeysForDetail', () => {
  it('returns an empty string when the spot has no fish types', () => {
    expect(commerce.fishKeysForDetail([])).toBe('');
  });

  it('keeps all five supported fish keys', () => {
    expect(commerce.fishKeysForDetail(['luofei', 'luyu', 'hei yu', 'qiaozui', 'luyu2'])).toBe(
      'luofei,luyu,hei yu,qiaozui,luyu2',
    );
  });

  it('caps the request at the first five fish keys', () => {
    expect(
      commerce.fishKeysForDetail([
        'luofei',
        'luyu',
        'hei yu',
        'qiaozui',
        'luyu2',
        'extra',
      ]),
    ).toBe('luofei,luyu,hei yu,qiaozui,luyu2');
  });
});

describe('commerce.loadProductCards', () => {
  it('returns an empty list when the product request rejects', async () => {
    requestMock.mockImplementation((options: WxRequestOptions) => {
      options.fail?.({ errMsg: 'request:fail' });
    });

    await expect(
      commerce.loadProductCards({
        surface: 'spot_detail',
        target_id: '01HX0000000000000000000001',
      }),
    ).resolves.toEqual([]);
  });

  it('returns the items from the product endpoint', async () => {
    requestMock.mockImplementation((options: WxRequestOptions) => {
      const response: WxResponse = {
        statusCode: 200,
        header: {},
        data: {
          code: 0,
          message: 'ok',
          data: { items: [productCard()] },
          request_id: 'req-test',
        },
      };
      options.success?.(response);
    });

    const items = await commerce.loadProductCards({
      surface: 'spot_detail',
      target_id: '01HX0000000000000000000001',
      fish_keys: 'luofei,luya',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.product_id).toBe('01HX0000000000000000000001');

    const requestOptions = requestMock.mock.calls[0]?.[0] as WxRequestOptions;
    expect(requestOptions.url).toContain('/api/v1/products?');
    expect(requestOptions.url).toContain('surface=spot_detail');
    expect(requestOptions.url).toContain('target_id=01HX0000000000000000000001');
    expect(requestOptions.url).toContain('fish_keys=luofei%2Cluya');
  });
});
