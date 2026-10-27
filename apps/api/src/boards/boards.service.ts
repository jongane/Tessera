import { Injectable, NotFoundException } from '@nestjs/common';
import type { Board } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from './board-access.js';

export interface NewBoard {
  name: string;
}

// The columns every new board starts with, in order. People can change them later.
export const DEFAULT_COLUMN_NAMES = ['To do', 'In progress', 'Done'] as const;

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
}
