import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import type { NewCard } from './cards.service.js';
import { nextPosition, takeNextSubtaskNumber } from './card-numbering.js';
import { MAX_DEPTH, moveSubtree } from './card-tree.js';
import { isDueAfter } from './card-fields.js';
import { cardRef, recordActivity } from '../activity/activity.js';

export interface DueDateWarnings {
  // The card is due after its parent.
  dueAfterParent: boolean;
  // The card's direct subtasks that are due after it.
  subtasksDueAfter: string[];
}

export interface SubtaskProgress {
  complete: number;
  total: number;
}

// Subtasks are ordinary cards with a parent card in the same project, on
// any of its boards (docs/card-features.md, section 4). Every method takes
// the user's id; a card the user cannot see is reported as not found.
@Injectable()
export class SubtasksService {
  constructor(private readonly prisma: PrismaService) {}

  // Like CardsService.createCard, the subtask gets its own thread. It is
  // numbered under its parent: WEB-12.1, WEB-12.2, ...
  async createSubtask(
    userId: string,
    parentId: string,
    columnId: string,
    card: NewCard,
  ): Promise<Card> {
    const parent = await this.findVisibleCard(userId, parentId);
    return this.prisma.$transaction((tx) =>
      insertSubtask(tx, userId, parent, columnId, card),
    );
  }

  // Moves a card, with its own subtasks, under another card in the same
  // project, or to the top level when `newParentId` is null. The moved cards
  // are renumbered and their old numbers keep working.
  async moveToParent(
    userId: string,
    cardId: string,
    newParentId: string | null,
  ): Promise<Card> {
    const card = await this.findVisibleCard(userId, cardId);
    const newParent = newParentId
      ? await this.findVisibleCard(userId, newParentId, card.projectId)
      : null;
    if (card.parentId === (newParent?.id ?? null)) {
      return card;
    }

    return this.prisma.$transaction((tx) =>
      moveSubtree(tx, userId, card, newParent),
    );
  }

  // The card's direct subtasks, in number order (1.2 before 1.10).
  async listSubtasks(userId: string, cardId: string): Promise<Card[]> {
    const card = await this.findVisibleCard(userId, cardId);
    const subtasks = await this.prisma.card.findMany({
      where: { parentId: card.id },
    });
    return subtasks.sort(
      (a, b) => lastNumber(a.numberPath) - lastNumber(b.numberPath),
    );
  }

  // "3 of 5 complete": counts direct subtasks only.
  async subtaskProgress(
    userId: string,
    cardId: string,
  ): Promise<SubtaskProgress> {
    const card = await this.findVisibleCard(userId, cardId);
    const [complete, total] = await Promise.all([
      this.prisma.card.count({
        where: { parentId: card.id, isComplete: true },
      }),
      this.prisma.card.count({ where: { parentId: card.id } }),
    ]);
    return { complete, total };
  }

  // A subtask due after its parent shows a warning on both cards. The date
  // is not blocked (docs/card-features.md, section 8). Worked out when read,
  // using the project's time zone.
  async dueDateWarnings(
    userId: string,
    cardId: string,
  ): Promise<DueDateWarnings> {
    const card = await this.findVisibleCard(userId, cardId);
    const [parent, subtasks, project] = await Promise.all([
      card.parentId
        ? this.prisma.card.findUnique({ where: { id: card.parentId } })
        : null,
      this.listSubtasks(userId, card.id),
      this.prisma.project.findUniqueOrThrow({
        where: { id: card.projectId },
        select: { timeZone: true },
      }),
    ]);
    const { timeZone } = project;
    return {
      dueAfterParent: parent ? isDueAfter(card, parent, timeZone) : false,
      subtasksDueAfter: subtasks
        .filter((subtask) => isDueAfter(subtask, card, timeZone))
        .map((subtask) => subtask.id),
    };
  }

  private async findVisibleCard(
    userId: string,
    cardId: string,
    projectId?: string,
  ): Promise<Card> {
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, projectId, board: boardsVisibleTo(userId) },
    });
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }
}

// Saves a new subtask of `parent` in a column on any board of the parent's
// project, inside the caller's transaction. Refuses a subtask deeper than
// 5 levels.
export async function insertSubtask(
  tx: Prisma.TransactionClient,
  userId: string,
  parent: Card,
  columnId: string,
  card: NewCard,
): Promise<Card> {
  if (parent.depth >= MAX_DEPTH) {
    throw new ConflictException(
      `Subtasks can only go ${MAX_DEPTH + 1} levels deep`,
    );
  }
  const column = await tx.column.findFirst({
    where: { id: columnId, board: { projectId: parent.projectId } },
  });
  if (!column) {
    throw new NotFoundException('Column not found');
  }
  const subtask = await tx.card.create({
    data: {
      ...card,
      projectId: parent.projectId,
      createdById: userId,
      boardId: column.boardId,
      columnId: column.id,
      parentId: parent.id,
      depth: parent.depth + 1,
      numberPath: await takeNextSubtaskNumber(tx, parent.id),
      position: await nextPosition(tx, column.id),
      thread: { create: { title: card.title } },
    },
  });
  await recordActivity(tx, subtask, userId, 'CREATED', {
    numberPath: subtask.numberPath,
    title: subtask.title,
  });
  await recordActivity(tx, parent, userId, 'SUBTASK_ADDED', {
    subtask: cardRef(subtask),
  });
  return subtask;
}

function lastNumber(numberPath: string): number {
  return Number(numberPath.slice(numberPath.lastIndexOf('.') + 1));
}
