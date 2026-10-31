import { ConflictException } from '@nestjs/common';
import type { ChatKind } from '../generated/prisma/client.js';

// The rules for linking a chat to a card, shared by every way of doing it.

export const ALREADY_LINKED = 'This chat is already linked to a card';

export function refuseGeneralChat(kind: ChatKind): void {
  if (kind === 'GENERAL') {
    throw new ConflictException(
      "A board's general chat cannot be linked to a card",
    );
  }
}
