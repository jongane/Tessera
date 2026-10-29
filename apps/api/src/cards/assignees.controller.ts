import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { type OwnerChange, ownerChangeSchema } from '@tessera/shared';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  AssigneesService,
  type AssigneeWithPerson,
} from './assignees.service.js';

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
    @Body(new ZodPipe(ownerChangeSchema)) body: OwnerChange,
  ): Promise<AssigneeWithPerson[]> {
    return this.assignees.setOwner(user.id, cardId, body.userId);
  }
}
