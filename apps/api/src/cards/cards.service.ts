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
import {
  lockColumns,
  nextPosition,
  placeCardAt,
  takeNextCardNumber,
} from './card-numbering.js';
import { loadSubtree, moveSubtree } from './card-tree.js';
import { requireEstimateMinutes } from '../time/time-input.js';
import { type DueInput, parseDue, requirePriority } from './card-fields.js';
import { lockCard } from './card-access.js';
import { cardRef, dueRef, recordActivity } from '../activity/activity.js';
import { ALREADY_LINKED, refuseGeneralChat } from '../chats/chat-rules.js';

const MAX_TITLE_LENGTH = 200;

export interface NewCard {
  title: string;
  description?: string;
}

export interface NewBoardCard extends NewCard {
  // A chat on the same board, with no card, to take instead of a new one.
  chatId?: string;
}

export interface CardChanges {
  title?: string;
  // An empty description clears it.
  description?: string;
  priority?: string;
  // A day, a day with a time, or null to clear it (see card-fields.ts).
  due?: DueInput;
  // Null clears it.
  estimateMinutes?: number | null;
}

// A card as the card screen shows it: with its full number (WEB-12.1,
// using the project's current code) and its chat, if it has one.
export type CardView = Card & {
  number: string;
  chat: { id: string; title: string } | null;
};

export interface CompletionOptions {
  // Complete a card even though some of its direct subtasks are still open.
  confirmOpenSubtasks?: boolean;
}

export interface MoveOptions extends CompletionOptions {
  // Where in the column: 0 is the top, past the end is the bottom. Left
  // out, the card goes to the bottom.
  position?: number;
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

  // A new card always gets its own chat, saved in the same step: a new one,
  // or the existing chat named, which must be on the same board and not
  // linked to a card. It goes to the bottom of the column and takes the
  // project's next number.
  async createCard(
    userId: string,
    columnId: string,
    { chatId, ...card }: NewBoardCard,
  ): Promise<Card> {
    const column = await this.findVisibleColumn(userId, columnId);
    const { projectId } = column.board;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.card.create({
        data: {
          ...card,
          projectId,
          createdById: userId,
          boardId: column.boardId,
          columnId,
          numberPath: await takeNextCardNumber(tx, projectId),
          position: await nextPosition(tx, columnId),
          ...(chatId === undefined && {
            chat: { create: { title: card.title } },
          }),
        },
      });
      if (chatId !== undefined) {
        await takeChat(tx, chatId, created);
      }
      await recordActivity(tx, created, userId, 'CREATED', {
        numberPath: created.numberPath,
        title: created.title,
      });
      return created;
    });
  }

  // Changes any of the card's fields. Every value is checked before anything
  // is saved, and all are saved together. The history keeps the old and new
  // value of each field that changed.
  async updateCard(
    userId: string,
    cardId: string,
    changes: CardChanges,
  ): Promise<Card> {
    const title =
      changes.title === undefined ? undefined : requireTitle(changes.title);
    const description =
      changes.description === undefined
        ? undefined
        : changes.description.trim() === ''
          ? null
          : changes.description;
    const priority =
      changes.priority === undefined
        ? undefined
        : requirePriority(changes.priority);
    const due = changes.due === undefined ? undefined : parseDue(changes.due);
    const estimateMinutes =
      changes.estimateMinutes === undefined
        ? undefined
        : requireEstimateMinutes(changes.estimateMinutes);
    const visible = await this.findVisibleCard(userId, cardId);
    return this.prisma.$transaction(async (tx) => {
      const card = await lockCard(tx, visible.id);
      const data: Prisma.CardUpdateInput = {};
      if (title !== undefined && title !== card.title) {
        await recordActivity(tx, card, userId, 'TITLE_CHANGED', {
          from: card.title,
          to: title,
        });
        data.title = title;
      }
      if (description !== undefined && description !== card.description) {
        await recordActivity(tx, card, userId, 'DESCRIPTION_CHANGED', {
          from: card.description,
          to: description,
        });
        data.description = description;
      }
      if (priority !== undefined && priority !== card.priority) {
        await recordActivity(tx, card, userId, 'PRIORITY_CHANGED', {
          from: card.priority,
          to: priority,
        });
        data.priority = priority;
      }
      if (due !== undefined) {
        const from = dueRef(card);
        const to = dueRef(due);
        if (from.at !== to.at || from.hasTime !== to.hasTime) {
          await recordActivity(tx, card, userId, 'DUE_DATE_CHANGED', {
            from,
            to,
          });
          Object.assign(data, due);
        }
      }
      if (
        estimateMinutes !== undefined &&
        estimateMinutes !== card.estimateMinutes
      ) {
        await recordActivity(tx, card, userId, 'ESTIMATE_CHANGED', {
          from: card.estimateMinutes,
          to: estimateMinutes,
        });
        data.estimateMinutes = estimateMinutes;
      }
      if (Object.keys(data).length === 0) {
        return card;
      }
      return tx.card.update({ where: { id: card.id }, data });
    });
  }

  async getCard(userId: string, cardId: string): Promise<CardView> {
    const card = await this.findVisibleCard(userId, cardId);
    return this.toView(card);
  }

  async toView(card: Card): Promise<CardView> {
    const [project, chat] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({
        where: { id: card.projectId },
        select: { code: true },
      }),
      this.prisma.chat.findUnique({
        where: { cardId: card.id },
        select: { id: true, title: true },
      }),
    ]);
    return { ...card, number: `${project.code}-${card.numberPath}`, chat };
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

  // Moves a card to another column on the same board, or to another place in
  // its own column. Moving into a done column completes the card; moving out
  // of one reopens it.
  async moveCard(
    userId: string,
    cardId: string,
    toColumnId: string,
    options: MoveOptions = {},
  ): Promise<Card> {
    const card = await this.findVisibleCard(userId, cardId);
    const column = await this.prisma.column.findFirst({
      where: { id: toColumnId, boardId: card.boardId },
      select: { id: true, name: true, isDone: true },
    });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    if (column.isDone && !card.isComplete) {
      await this.checkOpenSubtasks(card.id, options);
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await lockCard(tx, card.id);
      const fromColumn = await tx.column.findUniqueOrThrow({
        where: { id: current.columnId },
        select: { id: true, name: true, isDone: true },
      });
      await lockColumns(tx, [fromColumn.id, column.id]);
      const completion = completionChange(
        current,
        fromColumn.isDone,
        column.isDone,
      );
      let moved = await tx.card.update({
        where: { id: card.id },
        data: {
          columnId: column.id,
          position: await nextPosition(tx, column.id),
          ...completion,
        },
      });
      if (options.position !== undefined) {
        await placeCardAt(tx, moved, options.position);
        moved = await tx.card.findUniqueOrThrow({ where: { id: card.id } });
      }
      if (fromColumn.id !== column.id) {
        await recordActivity(tx, card, userId, 'MOVED', {
          from: { columnId: fromColumn.id, name: fromColumn.name },
          to: { columnId: column.id, name: column.name },
        });
      }
      if (completion.isComplete !== undefined) {
        await recordActivity(
          tx,
          card,
          userId,
          completion.isComplete ? 'COMPLETED' : 'REOPENED',
          {},
        );
      }
      return moved;
    });
  }

  // Ticks the card complete, and offers the board's done column if the card
  // is not in one already.
  async completeCard(
    userId: string,
    cardId: string,
    options: CompletionOptions = {},
  ): Promise<CompleteCardResult> {
    const card = await this.findVisibleCard(userId, cardId);
    if (!card.isComplete) {
      await this.checkOpenSubtasks(card.id, options);
    }
    const completed = await this.prisma.$transaction(async (tx) => {
      const current = await lockCard(tx, card.id);
      if (current.isComplete) {
        return current;
      }
      await recordActivity(tx, card, userId, 'COMPLETED', {});
      return tx.card.update({
        where: { id: card.id },
        data: { isComplete: true, completedAt: new Date() },
      });
    });
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
  setEstimate(
    userId: string,
    cardId: string,
    minutes: number | null,
  ): Promise<Card> {
    return this.updateCard(userId, cardId, { estimateMinutes: minutes });
  }

  setPriority(userId: string, cardId: string, priority: string): Promise<Card> {
    return this.updateCard(userId, cardId, { priority });
  }

  // A day, a day with a time, or null to clear it (see card-fields.ts).
  setDueDate(userId: string, cardId: string, due: DueInput): Promise<Card> {
    return this.updateCard(userId, cardId, { due });
  }

  async reopenCard(userId: string, cardId: string): Promise<Card> {
    const visible = await this.findVisibleCard(userId, cardId);
    return this.prisma.$transaction(async (tx) => {
      const card = await lockCard(tx, visible.id);
      if (!card.isComplete) {
        return card;
      }
      await recordActivity(tx, card, userId, 'REOPENED', {});
      return tx.card.update({
        where: { id: card.id },
        data: { isComplete: false, completedAt: null },
      });
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
          await deleteKeepingChat(tx, subtask.id);
        } else if (choice.action === 'standalone') {
          await moveSubtree(tx, userId, subtask, null);
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
          await moveSubtree(tx, userId, subtask, newParent);
        }
      }
      await deleteKeepingChat(tx, card.id);
      if (card.parentId) {
        await recordActivity(
          tx,
          { id: card.parentId, projectId: card.projectId },
          userId,
          'SUBTASK_REMOVED',
          { subtask: cardRef(card), deleted: true },
        );
      }
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
): { isComplete?: boolean; completedAt?: Date | null } {
  if (toDone && !card.isComplete) {
    return { isComplete: true, completedAt: new Date() };
  }
  if (fromDone && !toDone && card.isComplete) {
    return { isComplete: false, completedAt: null };
  }
  return {};
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(
      `A card title must be 1 to ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return trimmed;
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

// The card's chat is kept, unlinked, so its history is not lost.
async function deleteKeepingChat(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<void> {
  await tx.chat.updateMany({
    where: { cardId },
    data: { cardId: null },
  });
  await tx.card.delete({ where: { id: cardId } });
}

// Links an existing chat to a card just made, refusing the board's general
// chat and a chat already linked to a card. Only a chat with no card is
// updated, so when two new cards ask for the same chat one of them is
// refused, and its transaction is undone.
async function takeChat(
  tx: Prisma.TransactionClient,
  chatId: string,
  card: Card,
): Promise<void> {
  const chat = await tx.chat.findFirst({
    where: { id: chatId, boardId: card.boardId },
    select: { kind: true },
  });
  if (!chat) {
    throw new NotFoundException('Chat not found');
  }
  refuseGeneralChat(chat.kind);
  const { count } = await tx.chat.updateMany({
    where: { id: chatId, cardId: null },
    data: { cardId: card.id },
  });
  if (count === 0) {
    throw new ConflictException(ALREADY_LINKED);
  }
}
