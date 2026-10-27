import { Injectable, NotFoundException } from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { parseCardReference } from './card-number.js';

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
  // It goes to the bottom of the column and takes the project's next number.
  async createCard(
    userId: string,
    columnId: string,
    card: NewCard,
  ): Promise<Card> {
    const column = await this.findVisibleColumn(userId, columnId);
    const { projectId } = column.board;

    return this.prisma.$transaction(async (tx) =>
      tx.card.create({
        data: {
          ...card,
          projectId,
          boardId: column.boardId,
          columnId,
          numberPath: String(await takeNextCardNumber(tx, projectId)),
          position: await nextPosition(tx, columnId),
          thread: { create: { title: card.title } },
        },
      }),
    );
  }

  // Finds a card by a number such as "WEB-12". The project's old codes work
  // too. Null when the number is badly formed, unknown, or the user cannot
  // see the card.
  async findCardByNumber(
    userId: string,
    reference: string,
  ): Promise<Card | null> {
    const parsed = parseCardReference(reference);
    if (!parsed) {
      return null;
    }
    const projectCode = await this.prisma.projectCode.findUnique({
      where: { code: parsed.code },
      select: { projectId: true },
    });
    if (!projectCode) {
      return null;
    }
    return this.prisma.card.findFirst({
      where: {
        projectId: projectCode.projectId,
        numberPath: parsed.numberPath,
        board: boardsVisibleTo(userId),
      },
    });
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
      include: { board: { select: { projectId: true } } },
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

// Takes the project's next card number and moves its counter on. The update
// locks the project's row until the transaction ends, so two cards created
// at the same moment can never get the same number.
async function takeNextCardNumber(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { nextCardNumber: { increment: 1 } },
    select: { nextCardNumber: true },
  });
  return project.nextCardNumber - 1;
}
