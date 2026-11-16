import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { createApp } from '../src/app.factory';
import { buildOpenApiDocument } from '../src/openapi';

/**
 * The script runs from source (tsx) or from the compiled dist/openapi tree,
 * so locate apps/api by its package name instead of assuming a fixed depth.
 */
function findApiRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        name?: unknown;
      };
      if (packageJson.name === '@szfisher/api') {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error('Could not locate the @szfisher/api package root');
}

const apiRoot = findApiRoot(__dirname);
const outputPath = resolve(apiRoot, '..', '..', 'openapi', 'openapi.yaml');

/** Local/test defaults only; every value is inert and never a production secret. */
function applyLocalDefaults(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.PORT ??= '3000';
  process.env.DATABASE_URL ??=
    'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
  process.env.ADMIN_ORIGINS ??= 'https://fish-admin.unihuan.com';
  process.env.JWT_ACCESS_SECRET ??= 'openapi-generation-jwt-secret-0123456789';
  process.env.CSRF_SECRET ??= 'openapi-generation-csrf-secret-0123456789';
  process.env.TOTP_ENCRYPTION_KEY ??= 'openapi-generation-totp-key-0123456789';
  process.env.STORAGE_DRIVER ??= 'local';
  process.env.STORAGE_LOCAL_ROOT ??= mkdtempSync(join(tmpdir(), 'szfisher-openapi-'));
}

async function main(): Promise<void> {
  applyLocalDefaults();

  const app = await createApp();
  try {
    await app.init();
    const document = buildOpenApiDocument(app);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, stringify(document), 'utf8');
    console.log(`OpenAPI document written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
