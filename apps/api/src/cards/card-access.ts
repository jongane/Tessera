import { NotFoundException } from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';

// A card on a board the user can see. Any other card is reported as not
// found, so non-members cannot tell whether it exists.
export async function findVisibleCard(
  prisma: PrismaService,
  userId: string,
  cardId: string,
): Promise<Card> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, board: boardsVisibleTo(userId) },
  });
  if (!card) {
    throw new NotFoundException('Card not found');
  }
  return card;
}

// Holds the card's row until the transaction ends, so two changes to the
// same card run one after the other. Without it, two people assigned at the
// same moment could both become the owner, or two edits could both record
// the same "from" value in the card's history. Answers the card as it is now,
// and "not found" if another request deleted it while this one waited.
export async function lockCard(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<Card> {
  await tx.$queryRaw`SELECT id FROM cards WHERE id = ${cardId}::uuid FOR UPDATE`;
  const card = await tx.card.findUnique({ where: { id: cardId } });
  if (!card) {
    throw new NotFoundException('Card not found');
  }
  return card;
}

// The cards a change needs locked. `must` cards have to exist: one that is
// gone (deleted by a request that got there first) is "not found". `may`
// cards were read from the tree around them (subtasks, old parent); one that
// vanished while this waited is simply no longer part of it.
export interface CardsToLock {
  must: string[];
  may: string[];
}

// Locks the cards in id order, and answers "not found" if one that must exist
// is already gone.
async function lockCardsInOrder(
  tx: Prisma.TransactionClient,
  ids: string[],
  must: Set<string>,
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM cards WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  const found = new Set(locked.map((row) => row.id));
  if ([...must].some((id) => ids.includes(id) && !found.has(id))) {
    throw new NotFoundException('Card not found');
  }
}

// Locks every card `idsNeeded` names, in id order, and asks again: what a
// card looks like once it is locked can name more cards (its parent has
// changed, a subtask was added). Ends when everything named is locked, so
// whatever `idsNeeded` read in its last round is current.
export async function lockUntilCovered(
  tx: Prisma.TransactionClient,
  idsNeeded: () => Promise<CardsToLock>,
): Promise<void> {
  const held = new Set<string>();
  for (;;) {
    const { must, may } = await idsNeeded();
    const missing = [...new Set([...must, ...may])].filter(
      (id) => !held.has(id),
    );
    if (missing.length === 0) {
      return;
    }
    await lockCardsInOrder(tx, missing, new Set(must));
    missing.forEach((id) => held.add(id));
  }
}
