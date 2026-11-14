import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { retryOnCollision } from './retry-on-collision.js';

const MESSAGE = 'Someone changed this card at the same time. Try again.';

function writeConflict() {
  return new Prisma.PrismaClientKnownRequestError('conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

// Prisma reports a raw-query deadlock as P2010 with the PostgreSQL code inside.
function deadlock() {
  return new Prisma.PrismaClientKnownRequestError('deadlock detected', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: '40P01' },
  });
}

function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('could not serialize', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: '40001' },
  });
}

describe('retryOnCollision', () => {
  it('returns the result of a change that works first time, running it once', async () => {
    const change = vi.fn().mockResolvedValue('done');

    await expect(retryOnCollision(change)).resolves.toBe('done');
    expect(change).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a write conflict (P2034)', writeConflict],
    ['a deadlock (40P01)', deadlock],
    ['a serialization failure (40001)', serializationFailure],
  ])('tries again after %s and returns the result', async (_name, make) => {
    const change = vi
      .fn()
      .mockRejectedValueOnce(make())
      .mockRejectedValueOnce(make())
      .mockResolvedValue('done');

    await expect(retryOnCollision(change)).resolves.toBe('done');
    expect(change).toHaveBeenCalledTimes(3);
  });

  it('retries up to 3 times (4 runs in all), then answers 409 with the message', async () => {
    const change = vi.fn().mockRejectedValue(deadlock());

    const failure = await retryOnCollision(change).catch((e: unknown) => e);

    expect(change).toHaveBeenCalledTimes(4);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getStatus()).toBe(409);
    expect((failure as ConflictException).message).toBe(MESSAGE);
  });

  it('succeeds on the third retry', async () => {
    const change = vi
      .fn()
      .mockRejectedValueOnce(writeConflict())
      .mockRejectedValueOnce(writeConflict())
      .mockRejectedValueOnce(writeConflict())
      .mockResolvedValue('done');

    await expect(retryOnCollision(change)).resolves.toBe('done');
    expect(change).toHaveBeenCalledTimes(4);
  });

  it('does not retry other errors, and passes them on unchanged', async () => {
    const other = new Error('boom');
    const change = vi.fn().mockRejectedValue(other);

    await expect(retryOnCollision(change)).rejects.toBe(other);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('does not retry a Prisma error with another code', async () => {
    const unique = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const change = vi.fn().mockRejectedValue(unique);

    await expect(retryOnCollision(change)).rejects.toBe(unique);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error the change threw on purpose, such as a 404', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const refusal = new NotFoundException('No timer is running');
    const change = vi.fn().mockRejectedValue(refusal);

    await expect(retryOnCollision(change)).rejects.toBe(refusal);
    expect(change).toHaveBeenCalledTimes(1);
  });
});
