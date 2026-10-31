import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Board,
  Card,
  Column,
  LabelColour,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatCardNumber } from '../cards/card-number.js';
import { boardsVisibleTo } from './board-access.js';

export interface NewBoard {
  name: string;
}

// A card as the board shows it: its own fields plus its number, labels,
// assignees (owner first), progress counts and the id of its chat.
export type BoardCard = Omit<Card, 'nextSubtaskNumber'> & {
  number: string;
  labels: { id: string; name: string; colour: LabelColour }[];
  assignees: { id: string; displayName: string; isOwner: boolean }[];
  checklistProgress: { done: number; total: number };
  // Direct subtasks only (docs/card-features.md, section 4).
  subtaskProgress: { complete: number; total: number };
  chatId: string | null;
};

// Everything the board screen shows: its columns in order, each with its
// cards from top to bottom. One request, so the board needs no extra
// request per card.
export type BoardView = Board & {
  columns: (Column & { cards: BoardCard[] })[];
};

// What getBoardView reads for each card, beyond the card's own fields.
const boardCardDetails = {
  labels: {
    select: { label: { select: { id: true, name: true, colour: true } } },
    orderBy: { label: { name: 'asc' } },
  },
  assignees: {
    select: {
      isOwner: true,
      member: { select: { user: { select: { id: true, displayName: true } } } },
    },
    orderBy: [{ isOwner: 'desc' }, { assignedAt: 'asc' }],
  },
  checklists: { select: { items: { select: { isDone: true } } } },
  subtasks: { select: { isComplete: true } },
  chat: { select: { id: true } },
} satisfies Prisma.CardInclude;

// The columns every new board starts with, in order. People can change them later.
const DONE_COLUMN_NAME = 'Done';
export const DEFAULT_COLUMN_NAMES = [
  'To do',
  'In progress',
  DONE_COLUMN_NAME,
] as const;

export const GENERAL_CHAT_TITLE = 'General';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  // The board, its starting columns and its general chat are saved
  // together: if any part fails, none is saved.
  // Throws NotFoundException when the project does not exist or the user is
  // not a member, so callers cannot tell the two apart.
  async createBoard(
    userId: string,
    projectId: string,
    board: NewBoard,
  ): Promise<Board> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, members: { some: { userId } } },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return this.prisma.board.create({
      data: {
        ...board,
        projectId,
        columns: {
          create: DEFAULT_COLUMN_NAMES.map((name, position) => ({
            name,
            position,
            isDone: name === DONE_COLUMN_NAME,
          })),
        },
        chats: { create: { kind: 'GENERAL', title: GENERAL_CHAT_TITLE } },
      },
    });
  }

  listBoardsForProject(userId: string, projectId: string): Promise<Board[]> {
    return this.prisma.board.findMany({
      where: { projectId, ...boardsVisibleTo(userId) },
      orderBy: { name: 'asc' },
    });
  }

  // Returns null both when the board does not exist and when the user
  // cannot see it.
  findBoardForUser(boardId: string, userId: string): Promise<Board | null> {
    return this.prisma.board.findFirst({
      where: { id: boardId, ...boardsVisibleTo(userId) },
    });
  }

  async getBoardView(userId: string, boardId: string): Promise<BoardView> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...boardsVisibleTo(userId) },
      include: {
        project: { select: { code: true } },
        columns: {
          orderBy: { position: 'asc' },
          include: {
            cards: { orderBy: { position: 'asc' }, include: boardCardDetails },
          },
        },
      },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    const { project, columns, ...rest } = board;
    return {
      ...rest,
      columns: columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => toBoardCard(card, project.code)),
      })),
    };
  }

  // Marks a column as a done column, or not. Moving a card into a done
  // column completes it.
  async setColumnDone(
    userId: string,
    columnId: string,
    isDone: boolean,
  ): Promise<Column> {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, board: boardsVisibleTo(userId) },
      select: { id: true },
    });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    return this.prisma.column.update({
      where: { id: column.id },
      data: { isDone },
    });
  }
}

type CardWithDetails = Prisma.CardGetPayload<{
  include: typeof boardCardDetails;
}>;

function toBoardCard(card: CardWithDetails, projectCode: string): BoardCard {
  // nextSubtaskNumber is bookkeeping for numbering, not something to show.
  const {
    labels,
    assignees,
    checklists,
    subtasks,
    chat,
    nextSubtaskNumber: _nextSubtaskNumber,
    ...fields
  } = card;
  const items = checklists.flatMap((checklist) => checklist.items);
  return {
    ...fields,
    number: formatCardNumber(projectCode, card.numberPath),
    labels: labels.map(({ label }) => label),
    assignees: assignees.map(({ isOwner, member }) => ({
      ...member.user,
      isOwner,
    })),
    checklistProgress: {
      done: items.filter((item) => item.isDone).length,
      total: items.length,
    },
    subtaskProgress: {
      complete: subtasks.filter((subtask) => subtask.isComplete).length,
      total: subtasks.length,
    },
    chatId: chat?.id ?? null,
  };
}
