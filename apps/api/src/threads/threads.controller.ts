import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Thread } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { BoardsService } from '../boards/boards.service.js';
import {
  type NewThreadBody,
  newThreadSchema,
  type ThreadLink,
  threadLinkSchema,
} from './threads.schemas.js';
import { ThreadsService } from './threads.service.js';

@Controller()
export class ThreadsController {
  constructor(
    private readonly threads: ThreadsService,
    private readonly boards: BoardsService,
  ) {}

  // The general thread first, then the others oldest first.
  @Get('boards/:boardId/threads')
  async list(
    @CurrentUser() user: SignedInUser,
    @Param('boardId', IdParam) boardId: string,
  ): Promise<Thread[]> {
    if (!(await this.boards.findBoardForUser(boardId, user.id))) {
      throw new NotFoundException('Board not found');
    }
    return this.threads.listThreadsForBoard(user.id, boardId);
  }

  // A thread on its own, not linked to a card.
  @Post('boards/:boardId/threads')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('boardId', IdParam) boardId: string,
    @Body(new ZodPipe(newThreadSchema)) body: NewThreadBody,
  ): Promise<Thread> {
    return this.threads.createThread(user.id, boardId, body);
  }

  // Links the thread to a card on the same board.
  @Put('threads/:threadId/card')
  link(
    @CurrentUser() user: SignedInUser,
    @Param('threadId', IdParam) threadId: string,
    @Body(new ZodPipe(threadLinkSchema)) body: ThreadLink,
  ): Promise<Thread> {
    return this.threads.linkThreadToCard(user.id, threadId, body.cardId);
  }

  // Removes the link; the thread and the card are both kept.
  @Delete('threads/:threadId/card')
  unlink(
    @CurrentUser() user: SignedInUser,
    @Param('threadId', IdParam) threadId: string,
  ): Promise<Thread> {
    return this.threads.unlinkThread(user.id, threadId);
  }
}
