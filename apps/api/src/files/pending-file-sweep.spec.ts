import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FileStore } from '../storage/file-store.js';
import { PendingFileSweep } from './pending-file-sweep.js';

// Files on messages, PR B, criterion 9 (Jon, 2026-11-25): PendingFileSweep
// with a fake database and a fake store, no PostgreSQL. The narrowest seam the
// class has is `prisma.$queryRaw`, a tagged template that deletes the old
// pending rows and RETURNS their storage keys; the fake answers with the keys
// and records the cutoff it was given (the first value of the template).
const HOUR = 3_600_000;
const NOW = new Date('2026-11-25T12:00:00.000Z');

function setUp(keys: string[]) {
  const calls: string[] = [];
  const cutoffs: Date[] = [];
  const failFor = new Set<string>();
  const prisma = {
    $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push('rows');
      cutoffs.push(values[0] as Date);
      return Promise.resolve(keys.map((storage_key) => ({ storage_key })));
    },
  } as unknown as PrismaService;
  const store: FileStore = {
    put: () => Promise.resolve(),
    get: () => Promise.reject(new Error('not needed')),
    delete: (key: string) => {
      calls.push(`object ${key}`);
      return failFor.has(key)
        ? Promise.reject(new Error('storage is down'))
        : Promise.resolve();
    },
  };
  return {
    sweep: new PendingFileSweep(prisma, store),
    calls,
    cutoffs,
    failFor,
  };
}

describe('PendingFileSweep (unit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 9
  it('deletes the rows first and then the objects', async () => {
    const { sweep, calls } = setUp(['files/a', 'files/b']);

    await sweep.run(NOW);

    expect(calls).toEqual(['rows', 'object files/a', 'object files/b']);
  });

  // 9
  it('logs a failed object delete and goes on with the next one', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { sweep, calls, failFor } = setUp(['files/a', 'files/b']);
    failFor.add('files/a');

    await expect(sweep.run(NOW)).resolves.toBeUndefined();

    expect(calls).toEqual(['rows', 'object files/a', 'object files/b']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('files/a');
    expect(String(log.mock.calls[0]?.[0])).toContain('storage is down');
  });

  // 9
  it('takes the clock only from `now`: the cutoff is 24 hours before it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const { sweep, cutoffs } = setUp([]);

    await sweep.run(NOW);
    await sweep.run(new Date(NOW.getTime() + 5 * HOUR));
    vi.useRealTimers();

    expect(cutoffs.map((c) => c.toISOString())).toEqual([
      '2026-11-24T12:00:00.000Z',
      '2026-11-24T17:00:00.000Z',
    ]);
  });

  // 9
  it('deletes no object when no row was old enough', async () => {
    const { sweep, calls } = setUp([]);

    await sweep.run(NOW);

    expect(calls).toEqual(['rows']);
  });
});
