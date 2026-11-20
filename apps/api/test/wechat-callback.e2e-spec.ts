import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { wechatSignature } from '../src/modules/wechat-callback/wechat-signature';
import { createTestApp } from './create-test-app';

jest.setTimeout(30000);

const TOKEN = 'test-msg-token';

describe('WeChat media callback URL verification', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns echostr for a valid signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'test-nonce';
    const signature = wechatSignature(TOKEN, timestamp, nonce);
    const response = await request(server)
      .get('/api/v1/wechat/media-check/callback')
      .query({ signature, timestamp, nonce, echostr: 'hello-wechat' })
      .expect(200);
    expect(response.text).toBe('hello-wechat');
  });

  it('rejects a tampered signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await request(server)
      .get('/api/v1/wechat/media-check/callback')
      .query({ signature: 'bad', timestamp, nonce: 'test-nonce', echostr: 'hello' })
      .expect(403);
    expect(response.body.code).toBe(40301);
  });

  it('rejects a stale timestamp even with a valid signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const nonce = 'test-nonce';
    const signature = wechatSignature(TOKEN, timestamp, nonce);
    await request(server)
      .get('/api/v1/wechat/media-check/callback')
      .query({ signature, timestamp, nonce, echostr: 'hello' })
      .expect(403);
  });
});
