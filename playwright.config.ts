import { defineConfig, devices } from '@playwright/test';

export const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const API_ORIGIN = 'http://localhost:3011';
const ADMIN_ORIGIN = 'http://localhost:3010';
const PNPM = './scripts/pnpm.sh';

export default defineConfig({
  testDir: './apps/api/test/playwright',
  globalSetup: './apps/api/test/playwright/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: ADMIN_ORIGIN,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `${PNPM} --filter @szfisher/api dev`,
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'local',
        PORT: '3011',
        DATABASE_URL: TEST_DATABASE_URL,
        ADMIN_ORIGINS: ADMIN_ORIGIN,
        JWT_ACCESS_SECRET: 'playwright-jwt-access-secret-0123456789abcdef',
        CSRF_SECRET: 'playwright-csrf-secret-0123456789abcdef',
        TOTP_ENCRYPTION_KEY: 'playwright-totp-key-0123456789abcdef',
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_ROOT: '/tmp/szfisher-playwright-storage',
      },
    },
    {
      // Serve the same static export that ships in the admin image. This also
      // avoids Next's single-dev-server-per-directory restriction.
      command:
        `${PNPM} --filter @szfisher/api-client build && ${PNPM} --filter @szfisher/admin build && python3 -m http.server 3010 --bind 127.0.0.1 --directory apps/admin/out`,
      url: ADMIN_ORIGIN,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: `${API_ORIGIN}/api/v1`,
        NEXT_PUBLIC_TENCENT_MAP_JS_KEY: '',
      },
    },
  ],
});
