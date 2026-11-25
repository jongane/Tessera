import { ConflictException } from '@nestjs/common';
import { CHANGED_AT_THE_SAME_TIME_MESSAGE } from '@tessera/shared';
import { Prisma } from '../generated/prisma/client.js';

const RETRIES = 3;
const COLLISION_CODES = ['40P01', '40001'];

// The PostgreSQL code of a failed raw query: Prisma puts it in `meta.code`,
// or, through the pg driver adapter, in `meta.driverAdapterError.cause`.
function databaseCode(error: Prisma.PrismaClientKnownRequestError): unknown {
  const meta = error.meta as
    | {
        code?: unknown;
        driverAdapterError?: { cause?: { originalCode?: unknown } };
      }
    | undefined;
  return meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
}

function isCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // P2034: write conflict; P2028: the transaction expired while it waited.
  if (error.code === 'P2034' || error.code === 'P2028') return true;
  if (error.code !== 'P2010') return false;
  const code = databaseCode(error);
  return typeof code === 'string' && COLLISION_CODES.includes(code);
}

// Runs a whole change again when the database says two changes collided. After
// 3 retries it answers 409 with `message` (the card wording, unless a message
// change says otherwise). `change` must read everything it needs inside
// itself, so a retry never uses values left over from a failed attempt.
export async function retryOnCollision<T>(
  change: () => Promise<T>,
  options: { message?: string } = {},
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await change();
    } catch (error) {
      if (!isCollision(error)) throw error;
      if (retry >= RETRIES)
        throw new ConflictException(
          options.message ?? CHANGED_AT_THE_SAME_TIME_MESSAGE,
        );
    }
  }
}
