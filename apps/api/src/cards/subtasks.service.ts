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
import type { CardRelatives, RelatedCard } from '@tessera/shared';
import {
  loadAncestorIds,
  loadSubtree,
  MAX_DEPTH,
  moveSubtree,
} from './card-tree.js';
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

  // Like CardsService.createCard, the subtask gets its own chat. It is
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
    return subtasks.sort(byNumber);
  }

  // The card's parents, subtasks at every level and siblings, on any board
  // of the project, for outlining them when the card is selected
  // (docs/card-features.md, section 7).
  async relatives(userId: string, cardId: string): Promise<CardRelatives> {
    const visible = await this.findVisibleCard(userId, cardId);
    // One snapshot, so a card moved or deleted meanwhile can't give a
    // half-old answer.
    return this.prisma.$transaction(
      async (tx) => {
        const card = await tx.card.findUnique({ where: { id: visible.id } });
        if (!card) {
          throw new NotFoundException('Card not found');
        }
        const project = await tx.project.findUniqueOrThrow({
          where: { id: card.projectId },
          select: { code: true },
        });
        const withBoard = { board: { select: { name: true } } } as const;
        const related = (
          c: Card & { board: { name: string } },
        ): RelatedCard => ({
          id: c.id,
          number: `${project.code}-${c.numberPath}`,
          title: c.title,
          boardId: c.boardId,
          boardName: c.board.name,
          isComplete: c.isComplete,
        });

        const ancestorIds = await loadAncestorIds(tx, card.id);
        const below = (await loadSubtree(tx, card.id)).filter(
          (member) => member.id !== card.id,
        );
        const [ancestors, subtasks, siblings] = await Promise.all([
          tx.card.findMany({
            where: { id: { in: ancestorIds } },
            include: withBoard,
          }),
          tx.card.findMany({
            where: { id: { in: below.map((member) => member.id) } },
            include: withBoard,
          }),
          card.parentId
            ? tx.card.findMany({
                where: { parentId: card.parentId, id: { not: card.id } },
                include: withBoard,
              })
            : [],
        ]);
        return {
          // Nearest first: the deepest ancestor is the parent.
          parents: ancestors.sort((a, b) => b.depth - a.depth).map(related),
          subtasks: subtasks
            .sort(byNumber)
            .map((c) => ({ ...related(c), level: c.depth - card.depth })),
          siblings: siblings.sort(byNumber).map(related),
        };
      },
      { isolationLevel: 'RepeatableRead' },
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
// 5 levels. `fromChecklist` is the checklist an item came from, when the
// subtask replaces that item; the parent's history then says so.
export async function insertSubtask(
  tx: Prisma.TransactionClient,
  userId: string,
  parent: Card,
  columnId: string,
  card: NewCard,
  fromChecklist?: { id: string; name: string },
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
      chat: { create: { title: card.title } },
    },
  });
  await recordActivity(tx, subtask, userId, 'CREATED', {
    numberPath: subtask.numberPath,
    title: subtask.title,
  });
  if (fromChecklist) {
    await recordActivity(tx, parent, userId, 'CHECKLIST_ITEM_TO_SUBTASK', {
      checklistId: fromChecklist.id,
      checklistName: fromChecklist.name,
      subtask: cardRef(subtask),
    });
  } else {
    await recordActivity(tx, parent, userId, 'SUBTASK_ADDED', {
      subtask: cardRef(subtask),
    });
  }
  return subtask;
}

// Number order, part by part, so 1.2 comes before 1.10 and 1.1.1 comes
// right after 1.1.
function byNumber(
  a: Pick<Card, 'numberPath'>,
  b: Pick<Card, 'numberPath'>,
): number {
  const left = a.numberPath.split('.').map(Number);
  const right = b.numberPath.split('.').map(Number);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return left[i]! - right[i]!;
    }
  }
  return left.length - right.length;
}
