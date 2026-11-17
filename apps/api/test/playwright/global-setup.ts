import { execFileSync } from 'node:child_process';
import path from 'node:path';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';

export default async function globalSetup(): Promise<void> {
  // The seed is idempotent and only fills dictionaries/config/managed demo rows.
  execFileSync(
    path.resolve('scripts/pnpm.sh'),
    ['--filter', '@szfisher/api', 'prisma:seed'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'local',
        DATABASE_URL: TEST_DATABASE_URL,
      },
    },
  );
}
