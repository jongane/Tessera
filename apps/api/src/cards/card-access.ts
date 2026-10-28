import { NotFoundException } from '@nestjs/common';
import type { Card } from '../generated/prisma/client.js';
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
