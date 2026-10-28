import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  AssigneesService,
  type AssigneeWithPerson,
} from './assignees.service.js';

const ownerSchema = z.strictObject({ userId: z.uuid() });

// Each endpoint answers with the card's assignees afterwards, owner first.
@Controller('cards/:cardId')
export class AssigneesController {
  constructor(private readonly assignees: AssigneesService) {}

  @Get('assignees')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<AssigneeWithPerson[]> {
    return this.assignees.listAssignees(user.id, cardId);
  }

  // Only project members can be assigned. The first becomes the owner.
  @Put('assignees/:userId')
  assign(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Param('userId', IdParam) assigneeId: string,
  ): Promise<AssigneeWithPerson[]> {
    return this.assignees.assign(user.id, cardId, assigneeId);
  }

  // Removing the owner hands ownership to the person assigned longest.
  @Delete('assignees/:userId')
  unassign(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Param('userId', IdParam) assigneeId: string,
  ): Promise<AssigneeWithPerson[]> {
    return this.assignees.unassign(user.id, cardId, assigneeId);
  }

  @Put('owner')
  setOwner(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(ownerSchema)) body: z.infer<typeof ownerSchema>,
  ): Promise<AssigneeWithPerson[]> {
    return this.assignees.setOwner(user.id, cardId, body.userId);
  }
}
