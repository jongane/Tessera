import { ConflictException } from '@nestjs/common';
import type { ThreadKind } from '../generated/prisma/client.js';

// The rules for linking a thread to a card, shared by every way of doing it.

export const ALREADY_LINKED = 'This thread is already linked to a card';

export function refuseGeneralThread(kind: ThreadKind): void {
  if (kind === 'GENERAL') {
    throw new ConflictException(
      "A board's general thread cannot be linked to a card",
    );
  }
}
