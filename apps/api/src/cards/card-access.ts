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
// the same "from" value in the card's history.
export async function lockCard(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<Card> {
  await tx.$queryRaw`SELECT id FROM cards WHERE id = ${cardId}::uuid FOR UPDATE`;
  return tx.card.findUniqueOrThrow({ where: { id: cardId } });
}

// Locks the cards in id order, and answers "not found" if one is already gone
// (deleted by a request that got there first).
export async function lockCardsInOrder(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  const wanted = [...new Set(ids)];
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM cards WHERE id = ANY(${wanted}::uuid[]) ORDER BY id FOR UPDATE`;
  if (locked.length !== wanted.length) {
    throw new NotFoundException('Card not found');
  }
}
