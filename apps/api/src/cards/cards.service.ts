import { Injectable, NotFoundException } from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';

export interface NewCard {
  title: string;
  description?: string;
}

// Every method takes the user's id and only touches cards on boards the
// user can see. A card the user cannot see is reported as not found.
@Injectable()
export class CardsService {
  constructor(private readonly prisma: PrismaService) {}

  // A new card always gets its own thread, saved in the same step.
  // It goes to the bottom of the column.
  async createCard(
    userId: string,
    columnId: string,
    card: NewCard,
  ): Promise<Card> {
    const column = await this.findVisibleColumn(userId, columnId);

    return this.prisma.$transaction(async (tx) =>
      tx.card.create({
        data: {
          ...card,
          boardId: column.boardId,
          columnId,
          position: await nextPosition(tx, columnId),
          thread: { create: { title: card.title } },
        },
      }),
    );
  }

  // Moves a card to the bottom of another column on the same board.
  async moveCard(
    userId: string,
    cardId: string,
    toColumnId: string,
  ): Promise<Card> {
    const card = await this.findVisibleCard(userId, cardId);
    const column = await this.prisma.column.findFirst({
      where: { id: toColumnId, boardId: card.boardId },
      select: { id: true },
    });
    if (!column) {
      throw new NotFoundException('Column not found');
    }

    return this.prisma.$transaction(async (tx) =>
      tx.card.update({
        where: { id: card.id },
        data: {
          columnId: column.id,
          position: await nextPosition(tx, column.id),
        },
      }),
    );
  }

  // The card's thread is kept, unlinked, so its chat history is not lost.
  async deleteCard(userId: string, cardId: string): Promise<void> {
    const card = await this.findVisibleCard(userId, cardId);

    await this.prisma.$transaction([
      this.prisma.thread.updateMany({
        where: { cardId: card.id },
        data: { cardId: null },
      }),
      this.prisma.card.delete({ where: { id: card.id } }),
    ]);
  }

  private async findVisibleColumn(userId: string, columnId: string) {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, board: boardsVisibleTo(userId) },
    });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    return column;
  }

  private async findVisibleCard(userId: string, cardId: string) {
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, board: boardsVisibleTo(userId) },
    });
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }
}

// One past the highest position in the column, so the card lands at the bottom.
async function nextPosition(
  tx: Prisma.TransactionClient,
  columnId: string,
): Promise<number> {
  const { _max } = await tx.card.aggregate({
    where: { columnId },
    _max: { position: true },
  });
  return (_max.position ?? -1) + 1;
}
