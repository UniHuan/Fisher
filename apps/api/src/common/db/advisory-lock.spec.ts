import type { PrismaService } from '../../prisma/prisma.service';
import { withAdvisoryLock } from './advisory-lock';

interface TransactionClientStub {
  $queryRaw: jest.Mock;
}

interface PrismaStub {
  prisma: PrismaService;
  options: unknown[];
  queries: string[];
}

function makePrisma(locked: boolean): PrismaStub {
  const queries: string[] = [];
  const options: unknown[] = [];
  const client: TransactionClientStub = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      queries.push(sql);
      return Promise.resolve(sql.includes('pg_try_advisory_lock') ? [{ locked }] : []);
    }),
  };
  const prisma = {
    $transaction: jest.fn(
      async (fn: (tx: TransactionClientStub) => Promise<unknown>, transactionOptions?: unknown) => {
        options.push(transactionOptions);
        return fn(client);
      },
    ),
  } as unknown as PrismaService;
  return { prisma, options, queries };
}

describe('withAdvisoryLock', () => {
  it('applies the requested transaction timeout and releases the lock', async () => {
    const { prisma, options, queries } = makePrisma(true);

    const result = await withAdvisoryLock(prisma, 'job:test', async () => 'done', {
      timeoutMs: 120_000,
    });

    expect(result).toBe('done');
    expect(options).toEqual([{ timeout: 120_000 }]);
    expect(queries.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('keeps the default options and skips work when another instance holds the lock', async () => {
    const { prisma, options, queries } = makePrisma(false);
    const fn = jest.fn(async () => 'should-not-run');

    const result = await withAdvisoryLock(prisma, 'job:test', fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(options).toEqual([undefined]);
    expect(queries.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(false);
  });
});
