import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { parseCardReference } from './card-number.js';
import { nextPosition, takeNextCardNumber } from './card-numbering.js';
import { loadSubtree, moveSubtree } from './card-tree.js';
import { requireEstimateMinutes } from '../time/time-input.js';
import { type DueInput, parseDue, requirePriority } from './card-fields.js';

export interface NewCard {
  title: string;
  description?: string;
}

export interface CompletionOptions {
  // Complete a card even though some of its direct subtasks are still open.
  confirmOpenSubtasks?: boolean;
}

export interface CompleteCardResult {
  card: Card;
  // The board's done column to offer moving the card to, or null when the
  // card is already in a done column or the board has none.
  doneColumnId: string | null;
}

// What to do with each direct subtask when its parent is deleted.
export type SubtaskChoice =
  | { action: 'delete' }
  | { action: 'standalone' }
  | { action: 'move'; parentId: string };

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
          createdById: userId,
          boardId: column.boardId,
          columnId,
          numberPath: await takeNextCardNumber(tx, projectId),
          position: await nextPosition(tx, columnId),
          thread: { create: { title: card.title } },
        },
      }),
    );
  }

  // Finds a card by a number such as "WEB-12". The project's old codes, and
  // the card's old numbers from before it moved, work too. Null when the
  // number is badly formed, unknown, or the user cannot see the card.
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
    const { projectId } = projectCode;
    const visible = boardsVisibleTo(userId);
    return this.prisma.card.findFirst({
      where: {
        projectId,
        board: visible,
        OR: [
          { numberPath: parsed.numberPath },
          { oldNumbers: { some: { numberPath: parsed.numberPath } } },
        ],
      },
    });
  }

  // Moves a card to the bottom of another column on the same board. Moving
  // into a done column completes the card; moving out of one reopens it.
  async moveCard(
    userId: string,
    cardId: string,
    toColumnId: string,
    options: CompletionOptions = {},
  ): Promise<Card> {
    const card = await this.findVisibleCard(userId, cardId);
    const column = await this.prisma.column.findFirst({
      where: { id: toColumnId, boardId: card.boardId },
      select: { id: true, isDone: true },
    });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    const fromColumn = await this.prisma.column.findUniqueOrThrow({
      where: { id: card.columnId },
      select: { isDone: true },
    });
    if (column.isDone && !card.isComplete) {
      await this.checkOpenSubtasks(card.id, options);
    }

    return this.prisma.$transaction(async (tx) =>
      tx.card.update({
        where: { id: card.id },
        data: {
          columnId: column.id,
          position: await nextPosition(tx, column.id),
          ...completionChange(card, fromColumn.isDone, column.isDone),
        },
      }),
    );
  }

  // Ticks the card complete, and offers the board's done column if the card
  // is not in one already.
  async completeCard(
    userId: string,
    cardId: string,
    options: CompletionOptions = {},
  ): Promise<CompleteCardResult> {
    const card = await this.findVisibleCard(userId, cardId);
    let completed = card;
    if (!card.isComplete) {
      await this.checkOpenSubtasks(card.id, options);
      completed = await this.prisma.card.update({
        where: { id: card.id },
        data: { isComplete: true, completedAt: new Date() },
      });
    }
    const doneColumns = await this.prisma.column.findMany({
      where: { boardId: card.boardId, isDone: true },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const alreadyDone = doneColumns.some((c) => c.id === card.columnId);
    return {
      card: completed,
      doneColumnId: alreadyDone ? null : (doneColumns[0]?.id ?? null),
    };
  }

  // The card's own estimate in minutes; null clears it. A card with subtasks
  // shows the sum of theirs instead (CardTotalsService).
  async setEstimate(
    userId: string,
    cardId: string,
    minutes: number | null,
  ): Promise<Card> {
    const estimateMinutes = requireEstimateMinutes(minutes);
    const card = await this.findVisibleCard(userId, cardId);
    return this.prisma.card.update({
      where: { id: card.id },
      data: { estimateMinutes },
    });
  }

  async setPriority(
    userId: string,
    cardId: string,
    priority: string,
  ): Promise<Card> {
    const value = requirePriority(priority);
    const card = await this.findVisibleCard(userId, cardId);
    return this.prisma.card.update({
      where: { id: card.id },
      data: { priority: value },
    });
  }

  // A day, a day with a time, or null to clear it (see card-fields.ts).
  async setDueDate(
    userId: string,
    cardId: string,
    due: DueInput,
  ): Promise<Card> {
    const value = parseDue(due);
    const card = await this.findVisibleCard(userId, cardId);
    return this.prisma.card.update({ where: { id: card.id }, data: value });
  }

  async reopenCard(userId: string, cardId: string): Promise<Card> {
    const card = await this.findVisibleCard(userId, cardId);
    return this.prisma.card.update({
      where: { id: card.id },
      data: { isComplete: false, completedAt: null },
    });
  }

  // Deletes a card. A card with subtasks needs a choice for each direct
  // subtask: delete it, make it a top-level card, or move it under another
  // card. Deeper subtasks go with their own parent. Chats are kept, unlinked.
  // Cards with logged time are never deleted, so hours never disappear.
  // Only the person who created a card, or an admin, can delete it; the
  // same goes for each subtask chosen for deletion.
  async deleteCard(
    userId: string,
    cardId: string,
    choices: Record<string, SubtaskChoice> = {},
  ): Promise<void> {
    const card = await this.findVisibleCard(userId, cardId);
    const subtasks = await this.prisma.card.findMany({
      where: { parentId: card.id },
      include: { _count: { select: { subtasks: true } } },
    });
    checkChoicesCoverSubtasks(subtasks, choices);
    const toDelete = [
      card,
      ...subtasks.filter((subtask) => choices[subtask.id]!.action === 'delete'),
    ];
    await this.checkMayDelete(userId, card.projectId, toDelete);
    await this.checkNoLoggedTime(toDelete.map((c) => c.id));

    await this.prisma.$transaction(async (tx) => {
      const beingDeleted = new Set(
        (await loadSubtree(tx, card.id)).map((member) => member.id),
      );
      for (const subtask of subtasks) {
        const choice = choices[subtask.id]!;
        if (choice.action === 'delete') {
          if (subtask._count.subtasks > 0) {
            throw new ConflictException(
              'A subtask that has its own subtasks cannot be deleted here; ' +
                'decide what happens to its subtasks first',
            );
          }
          await deleteKeepingThread(tx, subtask.id);
        } else if (choice.action === 'standalone') {
          await moveSubtree(tx, subtask, null);
        } else {
          if (beingDeleted.has(choice.parentId)) {
            throw new BadRequestException(
              'A subtask cannot move under the card being deleted or its subtasks',
            );
          }
          const newParent = await tx.card.findFirst({
            where: {
              id: choice.parentId,
              projectId: card.projectId,
              board: boardsVisibleTo(userId),
            },
          });
          if (!newParent) {
            throw new NotFoundException('Card not found');
          }
          await moveSubtree(tx, subtask, newParent);
        }
      }
      await deleteKeepingThread(tx, card.id);
    });
  }

  // Refuses to complete a card while some of its direct subtasks are open,
  // unless the person has confirmed. The refusal says how many are open, so
  // the screen can ask "3 subtasks are still open. Complete anyway?"
  private async checkOpenSubtasks(
    cardId: string,
    options: CompletionOptions,
  ): Promise<void> {
    if (options.confirmOpenSubtasks) {
      return;
    }
    const openSubtasks = await this.prisma.card.count({
      where: { parentId: cardId, isComplete: false },
    });
    if (openSubtasks > 0) {
      throw new ConflictException({
        message: `${openSubtasks} subtasks are still open`,
        openSubtasks,
      });
    }
  }

  private async checkMayDelete(
    userId: string,
    projectId: string,
    toDelete: Card[],
  ): Promise<void> {
    const membership = await this.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId } },
    });
    if (
      membership.role !== 'ADMIN' &&
      toDelete.some((c) => c.createdById !== userId)
    ) {
      throw new ForbiddenException(
        'Only the person who created a card, or a project admin, can delete it',
      );
    }
  }

  // Refuses to delete cards with logged time, and says how much there is, so
  // the screen can explain why. An admin can delete the entries first.
  private async checkNoLoggedTime(cardIds: string[]): Promise<void> {
    const logged = await this.prisma.timeEntry.aggregate({
      where: { cardId: { in: cardIds } },
      _sum: { minutes: true },
    });
    const loggedMinutes = logged._sum.minutes ?? 0;
    if (loggedMinutes > 0) {
      throw new ConflictException({
        message: 'Cards with logged time cannot be deleted',
        loggedMinutes,
      });
    }
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

// What moving between columns changes: into a done column completes the
// card, out of one into a column that is not done reopens it.
function completionChange(
  card: Card,
  fromDone: boolean,
  toDone: boolean,
): Prisma.CardUncheckedUpdateInput {
  if (toDone && !card.isComplete) {
    return { isComplete: true, completedAt: new Date() };
  }
  if (fromDone && !toDone && card.isComplete) {
    return { isComplete: false, completedAt: null };
  }
  return {};
}

function checkChoicesCoverSubtasks(
  subtasks: Card[],
  choices: Record<string, SubtaskChoice>,
): void {
  const subtaskIds = new Set(subtasks.map((subtask) => subtask.id));
  const missing = subtasks.filter((subtask) => !choices[subtask.id]);
  const unknown = Object.keys(choices).filter((id) => !subtaskIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new BadRequestException({
      message: 'Choose what happens to each direct subtask, and only those',
      missingSubtaskIds: missing.map((subtask) => subtask.id),
      unknownSubtaskIds: unknown,
    });
  }
}

// The card's thread is kept, unlinked, so its chat history is not lost.
async function deleteKeepingThread(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<void> {
  await tx.thread.updateMany({
    where: { cardId },
    data: { cardId: null },
  });
  await tx.card.delete({ where: { id: cardId } });
}
