import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Card,
  Checklist,
  ChecklistItem,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { findVisibleCard } from '../cards/card-access.js';
import { insertSubtask } from '../cards/subtasks.service.js';
import { recordActivity } from '../activity/activity.js';

const MAX_NAME_LENGTH = 100;
const MAX_TEXT_LENGTH = 500;
const MAX_ITEMS = 100;
// Past this many checklists the screen suggests splitting the work into a
// new card. It is only a suggestion; there is no limit.
const SUGGEST_NEW_CARD_AFTER = 10;

export interface ChecklistProgress {
  done: number;
  total: number;
}

export type ChecklistWithItems = Checklist & {
  items: ChecklistItem[];
  // "2 of 4". Shown only on this card; never counted in a parent's progress.
  progress: ChecklistProgress;
};

export type NewChecklist = Checklist & {
  // True once the card has more than 10 checklists, so the screen can say
  // "This card has a lot of checklists. Start a new card?"
  suggestNewCard: boolean;
};

export interface ItemChanges {
  text?: string;
  isDone?: boolean;
}

// Named checklists on a card (docs/card-features.md, section 2). Any project
// member can change them. Checklists and items keep their `position` order;
// moving one renumbers its list from 0.
@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  // A new checklist goes after the card's others.
  async createChecklist(
    userId: string,
    cardId: string,
    name: string,
  ): Promise<NewChecklist> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    const checkedName = requireName(name);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.checklist.aggregate({
        where: { cardId: card.id },
        _count: true,
        _max: { position: true },
      });
      const checklist = await tx.checklist.create({
        data: {
          cardId: card.id,
          projectId: card.projectId,
          name: checkedName,
          position: (existing._max.position ?? -1) + 1,
        },
      });
      await recordActivity(tx, card, userId, 'CHECKLIST_ADDED', {
        checklistId: checklist.id,
        name: checklist.name,
      });
      return {
        ...checklist,
        suggestNewCard: existing._count + 1 > SUGGEST_NEW_CARD_AFTER,
      };
    });
  }

  async listChecklists(
    userId: string,
    cardId: string,
  ): Promise<ChecklistWithItems[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    const lists = await this.prisma.checklist.findMany({
      where: { cardId: card.id },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { position: 'asc' },
    });
    return lists.map((list) => ({
      ...list,
      progress: {
        done: list.items.filter((item) => item.isDone).length,
        total: list.items.length,
      },
    }));
  }

  async renameChecklist(
    userId: string,
    checklistId: string,
    name: string,
  ): Promise<Checklist> {
    const checkedName = requireName(name);
    const visible = await this.findVisibleChecklist(userId, checklistId);
    return this.prisma.$transaction(async (tx) => {
      const list = await lockChecklist(tx, visible.id);
      if (list.name === checkedName) {
        return list;
      }
      await recordActivity(tx, cardOf(list), userId, 'CHECKLIST_RENAMED', {
        checklistId: list.id,
        from: list.name,
        to: checkedName,
      });
      return tx.checklist.update({
        where: { id: list.id },
        data: { name: checkedName },
      });
    });
  }

  // Moves the checklist to `toIndex` among its card's checklists (0 is first).
  async moveChecklist(
    userId: string,
    checklistId: string,
    toIndex: number,
  ): Promise<void> {
    const list = await this.findVisibleChecklist(userId, checklistId);
    await this.prisma.$transaction(async (tx) => {
      const lists = await tx.checklist.findMany({
        where: { cardId: list.cardId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (const [position, id] of reorder(lists, list.id, toIndex)) {
        await tx.checklist.update({ where: { id }, data: { position } });
      }
    });
  }

  // Also deletes its items.
  async deleteChecklist(userId: string, checklistId: string): Promise<void> {
    const visible = await this.findVisibleChecklist(userId, checklistId);
    await this.prisma.$transaction(async (tx) => {
      const list = await lockChecklist(tx, visible.id);
      await tx.checklist.delete({ where: { id: list.id } });
      await recordActivity(tx, cardOf(list), userId, 'CHECKLIST_DELETED', {
        checklistId: list.id,
        name: list.name,
      });
    });
  }

  // A new item goes to the bottom of the checklist.
  async addItem(
    userId: string,
    checklistId: string,
    text: string,
  ): Promise<ChecklistItem> {
    const list = await this.findVisibleChecklist(userId, checklistId);
    const checkedText = requireText(text);
    return this.prisma.$transaction(async (tx) => {
      // Two items added at the same moment must not take it past the limit.
      await tx.$queryRaw`SELECT id FROM checklists WHERE id = ${list.id}::uuid FOR UPDATE`;
      const items = await tx.checklistItem.aggregate({
        where: { checklistId: list.id },
        _count: true,
        _max: { position: true },
      });
      if (items._count >= MAX_ITEMS) {
        throw new ConflictException(
          `A checklist can have at most ${MAX_ITEMS} items`,
        );
      }
      return tx.checklistItem.create({
        data: {
          checklistId: list.id,
          text: checkedText,
          position: (items._max.position ?? -1) + 1,
        },
      });
    });
  }

  async updateItem(
    userId: string,
    itemId: string,
    changes: ItemChanges,
  ): Promise<ChecklistItem> {
    const item = await this.findVisibleItem(userId, itemId);
    return this.prisma.checklistItem.update({
      where: { id: item.id },
      data: {
        text:
          changes.text === undefined ? undefined : requireText(changes.text),
        isDone: changes.isDone,
      },
    });
  }

  // Moves the item to `toIndex` in its checklist (0 is the top).
  async moveItem(
    userId: string,
    itemId: string,
    toIndex: number,
  ): Promise<void> {
    const item = await this.findVisibleItem(userId, itemId);
    await this.prisma.$transaction(async (tx) => {
      const items = await tx.checklistItem.findMany({
        where: { checklistId: item.checklistId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (const [position, id] of reorder(items, item.id, toIndex)) {
        await tx.checklistItem.update({ where: { id }, data: { position } });
      }
    });
  }

  async deleteItem(userId: string, itemId: string): Promise<void> {
    const item = await this.findVisibleItem(userId, itemId);
    await this.prisma.checklistItem.delete({ where: { id: item.id } });
  }

  // Replaces the item with a subtask of the card, titled with the item's
  // text, in the card's own column and unassigned. Both happen together, so
  // if the subtask cannot be made (5 levels deep already) the item stays.
  async turnItemIntoSubtask(userId: string, itemId: string): Promise<Card> {
    const item = await this.findVisibleItem(userId, itemId);
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: item.checklist.cardId },
    });
    return this.prisma.$transaction(async (tx) => {
      const subtask = await insertSubtask(
        tx,
        userId,
        card,
        card.columnId,
        { title: item.text },
        { id: item.checklist.id, name: item.checklist.name },
      );
      await tx.checklistItem.delete({ where: { id: item.id } });
      return subtask;
    });
  }

  private async findVisibleChecklist(
    userId: string,
    checklistId: string,
  ): Promise<Checklist> {
    const list = await this.prisma.checklist.findFirst({
      where: { id: checklistId, card: { board: boardsVisibleTo(userId) } },
    });
    if (!list) {
      throw new NotFoundException('Checklist not found');
    }
    return list;
  }

  private async findVisibleItem(userId: string, itemId: string) {
    const item = await this.prisma.checklistItem.findFirst({
      where: {
        id: itemId,
        checklist: { card: { board: boardsVisibleTo(userId) } },
      },
      include: {
        checklist: { select: { id: true, name: true, cardId: true } },
      },
    });
    if (!item) {
      throw new NotFoundException('Checklist item not found');
    }
    return item;
  }
}

// Holds the checklist's row until the transaction ends and reads it, so a
// rename or delete records the name it really had. Not found if another
// request deleted it first.
async function lockChecklist(
  tx: Prisma.TransactionClient,
  checklistId: string,
): Promise<Checklist> {
  await tx.$queryRaw`SELECT id FROM checklists WHERE id = ${checklistId}::uuid FOR UPDATE`;
  const list = await tx.checklist.findUnique({ where: { id: checklistId } });
  if (!list) {
    throw new NotFoundException('Checklist not found');
  }
  return list;
}

function cardOf(list: Checklist): { id: string; projectId: string } {
  return { id: list.cardId, projectId: list.projectId };
}

// The new [position, id] pairs after moving `movedId` to `toIndex`. An index
// past the end puts it last.
function reorder(
  rows: { id: string }[],
  movedId: string,
  toIndex: number,
): [number, string][] {
  if (!Number.isInteger(toIndex) || toIndex < 0) {
    throw new BadRequestException('A position must be 0 or more');
  }
  const ids = rows.map((row) => row.id).filter((id) => id !== movedId);
  const index = Math.min(toIndex, ids.length);
  ids.splice(index, 0, movedId);
  return ids.map((id, position) => [position, id]);
}

function requireName(name: string): string {
  return requireLength(name, MAX_NAME_LENGTH, 'A checklist name');
}

function requireText(text: string): string {
  return requireLength(text, MAX_TEXT_LENGTH, 'A checklist item');
}

function requireLength(value: string, max: number, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new BadRequestException(`${what} must be 1 to ${max} characters`);
  }
  return trimmed;
}
