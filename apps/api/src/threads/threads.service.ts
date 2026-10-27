import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Thread } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';

export interface NewThread {
  title: string;
}

// Every method takes the user's id and only touches threads on boards the
// user can see. A thread the user cannot see is reported as not found.
@Injectable()
export class ThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  // A thread on its own, not linked to any card.
  async createThread(
    userId: string,
    boardId: string,
    thread: NewThread,
  ): Promise<Thread> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...boardsVisibleTo(userId) },
      select: { id: true },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }

    return this.prisma.thread.create({
      data: { ...thread, boardId: board.id, kind: 'TOPIC' },
    });
  }

  // The general thread first, then the others oldest first.
  // Empty when the user cannot see the board.
  listThreadsForBoard(userId: string, boardId: string): Promise<Thread[]> {
    return this.prisma.thread.findMany({
      where: { boardId, board: boardsVisibleTo(userId) },
      // GENERAL is declared before TOPIC in the enum, so it sorts first.
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // Links a thread to a card on the same board. Refused when the thread is
  // the board's general thread, is already linked to a card, or the card
  // already has a thread: unlink first.
  async linkThreadToCard(
    userId: string,
    threadId: string,
    cardId: string,
  ): Promise<Thread> {
    const thread = await this.findVisibleThread(userId, threadId);
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, boardId: thread.boardId },
      include: { thread: { select: { id: true } } },
    });
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    if (thread.kind === 'GENERAL') {
      throw new ConflictException(
        "A board's general thread cannot be linked to a card",
      );
    }
    if (thread.cardId !== null && thread.cardId !== card.id) {
      throw new ConflictException('This thread is already linked to a card');
    }
    if (card.thread && card.thread.id !== thread.id) {
      throw new ConflictException('This card already has a thread');
    }

    try {
      return await this.prisma.thread.update({
        where: { id: thread.id },
        data: { cardId: card.id },
      });
    } catch (error) {
      // Someone else linked a thread to this card a moment ago.
      if (isUniqueViolation(error)) {
        throw new ConflictException('This card already has a thread');
      }
      throw error;
    }
  }

  // Removes a thread's link to its card. Both are kept.
  async unlinkThread(userId: string, threadId: string): Promise<Thread> {
    const thread = await this.findVisibleThread(userId, threadId);

    return this.prisma.thread.update({
      where: { id: thread.id },
      data: { cardId: null },
    });
  }

  private async findVisibleThread(userId: string, threadId: string) {
    const thread = await this.prisma.thread.findFirst({
      where: { id: threadId, board: boardsVisibleTo(userId) },
    });
    if (!thread) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
