import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { Card, ChecklistItem } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type ChecklistWithItems,
  ChecklistsService,
  type NewChecklist,
} from './checklists.service.js';

// The service trims and checks lengths (names up to 100, items up to 500).
const nameField = z.string().max(200);
const textField = z.string().max(1000);
// Where to move it: 0 is first. Past the end puts it last.
const positionField = z.number().int().min(0);

const newChecklistSchema = z.strictObject({ name: nameField });
const checklistChangesSchema = z.strictObject({
  name: nameField.optional(),
  position: positionField.optional(),
});
const newItemSchema = z.strictObject({ text: textField });
const itemChangesSchema = z.strictObject({
  text: textField.optional(),
  isDone: z.boolean().optional(),
  position: positionField.optional(),
});

@Controller()
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  // In order, each with its items and its own "2 of 4" progress.
  @Get('cards/:cardId/checklists')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<ChecklistWithItems[]> {
    return this.checklists.listChecklists(user.id, cardId);
  }

  // `suggestNewCard` is true once the card has more than 10 checklists.
  @Post('cards/:cardId/checklists')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(newChecklistSchema))
    body: z.infer<typeof newChecklistSchema>,
  ): Promise<NewChecklist> {
    return this.checklists.createChecklist(user.id, cardId, body.name);
  }

  // Renames and/or moves the checklist among its card's checklists.
  @Patch('checklists/:checklistId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async change(
    @CurrentUser() user: SignedInUser,
    @Param('checklistId', IdParam) checklistId: string,
    @Body(new ZodPipe(checklistChangesSchema))
    body: z.infer<typeof checklistChangesSchema>,
  ): Promise<void> {
    if (body.name !== undefined) {
      await this.checklists.renameChecklist(user.id, checklistId, body.name);
    }
    if (body.position !== undefined) {
      await this.checklists.moveChecklist(user.id, checklistId, body.position);
    }
  }

  // Also deletes its items.
  @Delete('checklists/:checklistId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('checklistId', IdParam) checklistId: string,
  ): Promise<void> {
    return this.checklists.deleteChecklist(user.id, checklistId);
  }

  // To the bottom of the checklist; at most 100 items (409).
  @Post('checklists/:checklistId/items')
  addItem(
    @CurrentUser() user: SignedInUser,
    @Param('checklistId', IdParam) checklistId: string,
    @Body(new ZodPipe(newItemSchema)) body: z.infer<typeof newItemSchema>,
  ): Promise<ChecklistItem> {
    return this.checklists.addItem(user.id, checklistId, body.text);
  }

  // Edits, ticks and/or moves the item within its checklist.
  @Patch('checklist-items/:itemId')
  changeItem(
    @CurrentUser() user: SignedInUser,
    @Param('itemId', IdParam) itemId: string,
    @Body(new ZodPipe(itemChangesSchema))
    body: z.infer<typeof itemChangesSchema>,
  ): Promise<ChecklistItem> {
    return this.checklists.updateItem(user.id, itemId, body);
  }

  @Delete('checklist-items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @CurrentUser() user: SignedInUser,
    @Param('itemId', IdParam) itemId: string,
  ): Promise<void> {
    return this.checklists.deleteItem(user.id, itemId);
  }

  // Replaces the item with an unassigned subtask of the card, titled with
  // the item's text, in the card's column.
  @Post('checklist-items/:itemId/subtask')
  toSubtask(
    @CurrentUser() user: SignedInUser,
    @Param('itemId', IdParam) itemId: string,
  ): Promise<Card> {
    return this.checklists.turnItemIntoSubtask(user.id, itemId);
  }
}
