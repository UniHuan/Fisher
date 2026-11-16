import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('CI Docker verification', () => {
  it('builds the API image and validates both Compose files', () => {
    const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(workflow).toContain('docker:');
    expect(workflow).toContain(
      'docker build -f infra/docker/Dockerfile.api -t szfisher-api:ci .',
    );
    expect(workflow).toContain('docker compose -f infra/docker/docker-compose.yml config');
    expect(workflow).toContain('docker compose -f infra/docker/docker-compose.test.yml config');
    expect(workflow).toContain('contents: read');

    const dockerfile = readFileSync(join(REPO_ROOT, 'infra', 'docker', 'Dockerfile.api'), 'utf8');
    expect(dockerfile).toContain(
      'ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public',
    );
  });
});
