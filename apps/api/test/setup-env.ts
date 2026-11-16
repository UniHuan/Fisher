import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test defaults only. Use ??= so CI-provided values always win.
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3999';
process.env.DATABASE_URL ??=
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
process.env.ADMIN_ORIGINS ??= 'https://admin.szfisher.test';
process.env.JWT_ACCESS_SECRET ??= 'test-jwt-access-secret-0123456789abcdef';
process.env.CSRF_SECRET ??= 'test-csrf-secret-0123456789abcdefghij';
process.env.TOTP_ENCRYPTION_KEY ??= 'test-totp-encryption-key-0123456789abcdef';
process.env.STORAGE_DRIVER ??= 'local';
process.env.STORAGE_LOCAL_ROOT ??= join(tmpdir(), 'szfisher-api-test-storage');
