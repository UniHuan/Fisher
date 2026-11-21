import { HttpStatus } from '@nestjs/common';
import { COMMERCE_CHANNEL, ERROR_CODES, PURCHASE_ACTION_TYPE } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { PurchaseActionService } from './purchase-action.service';

const VALID_APP_ID = 'wx0123456789abcdef';
const VALID_PATH = '/pages/product/detail?id=1';
const VALID_URL = 'https://weidian.com/item.html?itemID=1';

function expectValidationError(run: () => unknown): void {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: ERROR_CODES.VALIDATION,
    httpStatus: HttpStatus.BAD_REQUEST,
  });
}

describe('PurchaseActionService', () => {
  const service = new PurchaseActionService();

  describe('mini_program actions', () => {
    it('accepts a weidian mini program action with all fields', () => {
      expect(
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: VALID_APP_ID,
          path: VALID_PATH,
          fallback_url: VALID_URL,
        }),
      ).toEqual({
        type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
        app_id: VALID_APP_ID,
        path: VALID_PATH,
        fallback_url: VALID_URL,
      });
    });

    it('keeps fallback_url optional', () => {
      const result = service.validate(COMMERCE_CHANNEL.WEIDIAN, {
        type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
        app_id: VALID_APP_ID,
        path: VALID_PATH,
      });

      expect(result).toEqual({
        type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
        app_id: VALID_APP_ID,
        path: VALID_PATH,
      });
      expect(result.fallback_url).toBeUndefined();
    });

    it.each([
      ['missing', undefined],
      ['missing the wx prefix', '0123456789abcdef'],
      ['shorter than 16 hex characters', 'wx0123456789abcde'],
      ['longer than 16 hex characters', 'wx0123456789abcdef0'],
      ['not lowercase hex', 'wx0123456789ABCDEF'],
      ['containing non-hex characters', 'wx0123456789abcdeg'],
    ])('rejects app_id that is %s', (_label, appId) => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: appId,
          path: VALID_PATH,
        }),
      );
    });

    it('rejects a path that does not start with /', () => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: VALID_APP_ID,
          path: 'pages/product/detail?id=1',
        }),
      );
    });

    it('accepts a path of exactly 200 characters', () => {
      const path = `/${'a'.repeat(199)}`;

      expect(
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: VALID_APP_ID,
          path,
        }),
      ).toEqual({
        type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
        app_id: VALID_APP_ID,
        path,
      });
    });

    it('rejects a path longer than 200 characters', () => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: VALID_APP_ID,
          path: `/${'a'.repeat(200)}`,
        }),
      );
    });

    it.each([
      ['http', 'http://weidian.com/item.html?itemID=1'],
      ['protocol-relative', '//weidian.com/item.html?itemID=1'],
    ])('rejects a fallback_url that is %s', (_label, fallbackUrl) => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
          app_id: VALID_APP_ID,
          path: VALID_PATH,
          fallback_url: fallbackUrl,
        }),
      );
    });
  });

  describe.each([PURCHASE_ACTION_TYPE.H5, PURCHASE_ACTION_TYPE.COPY_LINK])(
    '%s actions',
    (type) => {
      it('accepts an https url', () => {
        expect(service.validate(COMMERCE_CHANNEL.WEIDIAN, { type, url: VALID_URL })).toEqual({
          type,
          url: VALID_URL,
        });
      });

      it.each([
        ['missing', undefined],
        ['http', 'http://weidian.com/item.html?itemID=1'],
        ['protocol-relative', '//weidian.com/item.html?itemID=1'],
        ['empty', ''],
      ])('rejects a url that is %s', (_label, url) => {
        expectValidationError(() =>
          service.validate(COMMERCE_CHANNEL.WEIDIAN, { type, url }),
        );
      });

      it('accepts a url of exactly 500 characters', () => {
        const url = `https://${'a'.repeat(492)}`;

        expect(url).toHaveLength(500);
        expect(service.validate(COMMERCE_CHANNEL.WEIDIAN, { type, url })).toEqual({ type, url });
      });

      it('rejects a url longer than 500 characters', () => {
        const url = `https://${'a'.repeat(493)}`;

        expect(url).toHaveLength(501);
        expectValidationError(() =>
          service.validate(COMMERCE_CHANNEL.WEIDIAN, { type, url }),
        );
      });
    },
  );

  it('drops fields that do not belong to the action type', () => {
    expect(
      service.validate(COMMERCE_CHANNEL.WEIDIAN, {
        type: PURCHASE_ACTION_TYPE.H5,
        url: VALID_URL,
        app_id: VALID_APP_ID,
        path: VALID_PATH,
        fallback_url: 'https://example.com/fallback',
        toast: 'ignored for h5',
      }),
    ).toEqual({ type: PURCHASE_ACTION_TYPE.H5, url: VALID_URL });
  });

  it('keeps toast for copy_link and drops it for h5', () => {
    expect(
      service.validate(COMMERCE_CHANNEL.WEIDIAN, {
        type: PURCHASE_ACTION_TYPE.COPY_LINK,
        url: VALID_URL,
        toast: '链接已复制',
      }),
    ).toEqual({ type: PURCHASE_ACTION_TYPE.COPY_LINK, url: VALID_URL, toast: '链接已复制' });

    expect(
      service.validate(COMMERCE_CHANNEL.WEIDIAN, {
        type: PURCHASE_ACTION_TYPE.H5,
        url: VALID_URL,
        toast: 'ignored for h5',
      }),
    ).toEqual({ type: PURCHASE_ACTION_TYPE.H5, url: VALID_URL });
  });

  describe('V1 allowlists', () => {
    it('rejects the reserved jd channel', () => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.JD, {
          type: PURCHASE_ACTION_TYPE.H5,
          url: VALID_URL,
        }),
      );
    });

    it('rejects an unknown channel', () => {
      expectValidationError(() =>
        service.validate('taobao', {
          type: PURCHASE_ACTION_TYPE.H5,
          url: VALID_URL,
        }),
      );
    });

    it('rejects the reserved qr action type', () => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: PURCHASE_ACTION_TYPE.QR,
          url: VALID_URL,
        }),
      );
    });

    it('rejects an unknown action type', () => {
      expectValidationError(() =>
        service.validate(COMMERCE_CHANNEL.WEIDIAN, {
          type: 'unknown',
          url: VALID_URL,
        }),
      );
    });
  });
});
