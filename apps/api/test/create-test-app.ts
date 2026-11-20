import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { AppModuleOptions } from '../src/app.module';
import { createApp } from '../src/app.factory';
import { TestAdminController } from './support/test-admin.controller';

const TEST_DATABASE_URL = 'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const TEST_ADMIN_ORIGINS = 'https://admin.szfisher.test,https://admin-staging.szfisher.test';
const TEST_JWT_ACCESS_SECRET = 'test-jwt-access-secret-0123456789abcdef';
const TEST_CSRF_SECRET = 'test-csrf-secret-0123456789abcdefghij';
const TEST_TOTP_ENCRYPTION_KEY = 'test-totp-encryption-key-0123456789abcdef';

export async function createTestApp(options: AppModuleOptions = {}): Promise<INestApplication> {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3999';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.ADMIN_ORIGINS = TEST_ADMIN_ORIGINS;
  process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
  process.env.CSRF_SECRET = TEST_CSRF_SECRET;
  process.env.TOTP_ENCRYPTION_KEY = TEST_TOTP_ENCRYPTION_KEY;
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), 'szfisher-api-test-'));

  const app = await createApp([TestAdminController], options);
  await app.init();
  return app;
}
