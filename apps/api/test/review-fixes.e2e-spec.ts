import { Logger, type ArgumentsHost, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { RequestWithContext } from '../src/common/types/request-context';
import { createTestApp } from './create-test-app';

interface MockResponse {
  headersSent: boolean;
  status: jest.Mock;
  json: jest.Mock;
  getHeader: jest.Mock;
  setHeader: jest.Mock;
}

function createMockResponse(headersSent = false): MockResponse {
  const response: MockResponse = {
    headersSent,
    status: jest.fn(),
    json: jest.fn(),
    getHeader: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function createRequest(): RequestWithContext {
  return {
    requestId: 'req_filter_test_0001',
    method: 'POST',
    path: '/api/v1/import',
  } as RequestWithContext;
}

function createHost(request: RequestWithContext, response: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps raw 413 errors through the status table without leaking the message', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = createMockResponse();
    const filter = new AllExceptionsFilter();
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
    });

    filter.catch(error, createHost(createRequest(), response));

    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({
      code: 41301,
      message: 'Payload too large',
      data: null,
      request_id: 'req_filter_test_0001',
    });
    expect(JSON.stringify(response.json.mock.calls[0]?.[0])).not.toContain(
      'request entity too large',
    );
  });

  it('does not write a response when headers were already sent', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = createMockResponse(true);
    const filter = new AllExceptionsFilter();

    filter.catch(new Error('late failure'), createHost(createRequest(), response));

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('request_id=req_filter_test_0001'));
  });

  it('includes request id, method and path in unexpected-error logs', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = createMockResponse();
    const filter = new AllExceptionsFilter();

    filter.catch(new Error('boom'), createHost(createRequest(), response));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 50001,
        message: 'Internal server error',
        request_id: 'req_filter_test_0001',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('request_id=req_filter_test_0001 method=POST path=/api/v1/import'),
    );
  });
});

describe('HTTP hardening', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes Zod-validated settings through ConfigService', () => {
    const config = app.get(ConfigService);
    expect(config.getOrThrow<number>('PORT')).toBe(3999);
    expect(config.getOrThrow<string[]>('ADMIN_ORIGINS')).toEqual([
      'https://admin.szfisher.test',
      'https://admin-staging.szfisher.test',
    ]);
    expect(config.getOrThrow<string>('JWT_ACCESS_SECRET')).toBe(
      'test-jwt-access-secret-0123456789abcdef',
    );
  });

  it('allows Idempotency-Key in CORS preflight and exposes X-Request-Id', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/spots')
      .set('Origin', 'https://admin.szfisher.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe('https://admin.szfisher.test');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'idempotency-key',
    );
    expect(String(res.headers['access-control-expose-headers']).toLowerCase()).toContain(
      'x-request-id',
    );
  });

  it('accepts JSON bodies above the 100 KB Express default', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/missing')
      .set('X-Client-Type', 'miniprogram')
      .set('X-Client-Version', '1.0.0')
      .send({ payload: 'x'.repeat(200 * 1024) })
      .expect(404);

    expect(res.body.code).toBe(40401);
  });

  it('rejects JSON bodies over 2 MB with 41301 and no parser detail', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/missing')
      .set('X-Client-Type', 'miniprogram')
      .set('X-Client-Version', '1.0.0')
      .send({ payload: 'x'.repeat(2 * 1024 * 1024 + 1024) })
      .expect(413);

    expect(res.body).toMatchObject({ code: 41301, message: 'Payload too large' });
    expect(res.body.request_id).toMatch(/^req_/);
    expect(res.headers['x-request-id']).toBe(res.body.request_id);
    expect(res.text).not.toContain('request entity too large');
  });
});
