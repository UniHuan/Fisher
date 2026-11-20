import { parseEnv } from './env.schema';

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PORT: '3001',
  DATABASE_URL: 'postgresql://szfisher:szfisher@postgres:5432/szfisher?schema=public',
  ADMIN_ORIGINS: 'https://admin.example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  CSRF_SECRET: 'b'.repeat(32),
  TOTP_ENCRYPTION_KEY: 'c'.repeat(32),
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_ROOT: '/app/storage',
};

const PREPROCESSED_V11_KEYS = [
  'APP_JWT_ACCESS_SECRET',
  'WECHAT_MINI_APPID',
  'WECHAT_MINI_SECRET',
  'WECHAT_MSG_AES_KEY',
  'UGC_TERMS_VERSION',
  'LEGAL_BASE_URL',
] as const;

const V11_KEYS = [...PREPROCESSED_V11_KEYS, 'WECHAT_MSG_TOKEN'] as const;

function envWithV11Values(value: string): NodeJS.ProcessEnv {
  return { ...BASE_ENV, ...Object.fromEntries(V11_KEYS.map((key) => [key, value])) };
}

describe('env schema V1.1 optional keys', () => {
  it('treats empty values as absent so V1.0 boots with production compose defaults', () => {
    const env = parseEnv(envWithV11Values(''));

    for (const key of PREPROCESSED_V11_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('treats whitespace-only values as absent', () => {
    const env = parseEnv(envWithV11Values('   '));

    for (const key of PREPROCESSED_V11_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('keeps valid non-empty values', () => {
    const env = parseEnv({
      ...BASE_ENV,
      APP_JWT_ACCESS_SECRET: 'd'.repeat(32),
      WECHAT_MINI_APPID: 'wx-test-appid',
      WECHAT_MINI_SECRET: 'wx-test-secret',
      WECHAT_MSG_TOKEN: 'test-msg-token',
      WECHAT_MSG_AES_KEY: 'test-msg-aes-key',
      UGC_TERMS_VERSION: '2026-11-20',
      LEGAL_BASE_URL: 'https://fish.unihuan.com/legal',
    });

    expect(env.APP_JWT_ACCESS_SECRET).toBe('d'.repeat(32));
    expect(env.WECHAT_MINI_APPID).toBe('wx-test-appid');
    expect(env.UGC_TERMS_VERSION).toBe('2026-11-20');
    expect(env.LEGAL_BASE_URL).toBe('https://fish.unihuan.com/legal');
  });

  it('still enforces min and url checks for non-empty values', () => {
    expect(() => parseEnv({ ...BASE_ENV, APP_JWT_ACCESS_SECRET: 'short' })).toThrow(
      'APP_JWT_ACCESS_SECRET',
    );
    expect(() => parseEnv({ ...BASE_ENV, LEGAL_BASE_URL: 'not-a-url' })).toThrow('LEGAL_BASE_URL');
  });
});
