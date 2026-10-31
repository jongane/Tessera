import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { Card } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type NewSubtaskBody,
  newSubtaskSchema,
  type ParentChange,
  parentChangeSchema,
} from '@tessera/shared';
import {
  type DueDateWarnings,
  SubtasksService,
  type SubtaskProgress,
} from './subtasks.service.js';

@Controller('cards/:cardId')
export class SubtasksController {
  constructor(private readonly subtasks: SubtasksService) {}

  // The card's direct subtasks in number order, and "3 of 5 complete".
  @Get('subtasks')
  async list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<{ subtasks: Card[]; progress: SubtaskProgress }> {
    const [subtasks, progress] = await Promise.all([
      this.subtasks.listSubtasks(user.id, cardId),
      this.subtasks.subtaskProgress(user.id, cardId),
    ]);
    return { subtasks, progress };
  }

  // Numbered under the card (WEB-12.1), with its own chat.
  @Post('subtasks')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(newSubtaskSchema)) body: NewSubtaskBody,
  ): Promise<Card> {
    const { columnId, ...card } = body;
    return this.subtasks.createSubtask(user.id, cardId, columnId, card);
  }

  // Moves the card, with its own subtasks, under another card in the same
  // project, or to the top level. Old numbers keep working.
  @Put('parent')
  changeParent(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(parentChangeSchema)) body: ParentChange,
  ): Promise<Card> {
    return this.subtasks.moveToParent(user.id, cardId, body.parentId);
  }

  // Due later than its parent, or subtasks due later than it. Shown as a
  // warning; the date is not blocked.
  @Get('due-warnings')
  dueWarnings(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<DueDateWarnings> {
    return this.subtasks.dueDateWarnings(user.id, cardId);
  }
}
