#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

function refuse(message) {
  console.error(`prisma:test:prepare refused: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  refuse('DATABASE_URL is not a valid URL');
}

const host = parsed.hostname;
const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
if (!ALLOWED_HOSTS.has(host)) {
  refuse(`host "${host}" is not localhost or 127.0.0.1`);
}
if (!database.endsWith('_test')) {
  refuse(`database "${database || '(empty)'}" does not end with "_test"`);
}

const prismaBinary = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const apiRoot = path.resolve(import.meta.dirname, '..');

function runPrisma(args) {
  const result = spawnSync(prismaBinary, args, {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.error) {
    refuse(`could not run Prisma: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Preparing test database at ${host}/${database}`);
runPrisma(['generate']);
runPrisma(['migrate', 'reset', '--force', '--skip-seed']);
runPrisma(['db', 'seed']);
