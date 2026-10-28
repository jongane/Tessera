import { Injectable, NotFoundException } from '@nestjs/common';
import type { Board, Card, Column } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from './board-access.js';

export interface NewBoard {
  name: string;
}

// Everything the board screen shows: its columns in order, each with its
// cards from top to bottom.
export type BoardView = Board & {
  columns: (Column & { cards: Card[] })[];
};

// The columns every new board starts with, in order. People can change them later.
const DONE_COLUMN_NAME = 'Done';
export const DEFAULT_COLUMN_NAMES = [
  'To do',
  'In progress',
  DONE_COLUMN_NAME,
] as const;

export const GENERAL_THREAD_TITLE = 'General';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  // The board, its starting columns and its general thread are saved
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
        threads: { create: { kind: 'GENERAL', title: GENERAL_THREAD_TITLE } },
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
        columns: {
          orderBy: { position: 'asc' },
          include: { cards: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    return board;
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
