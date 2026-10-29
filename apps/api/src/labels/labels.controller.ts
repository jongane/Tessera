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
  Put,
} from '@nestjs/common';
import {
  type LabelChangesBody,
  labelChangesSchema,
  type NewLabelBody,
  newLabelSchema,
} from '@tessera/shared';
import type { Label } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { LabelsService } from './labels.service.js';

@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  // The project's labels, by name.
  @Get('projects/:projectId/labels')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
  ): Promise<Label[]> {
    return this.labels.listLabels(user.id, projectId);
  }

  // Any member can create a label.
  @Post('projects/:projectId/labels')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Body(new ZodPipe(newLabelSchema)) body: NewLabelBody,
  ): Promise<Label> {
    return this.labels.createLabel(user.id, projectId, body);
  }

  // Admins only.
  @Patch('labels/:labelId')
  change(
    @CurrentUser() user: SignedInUser,
    @Param('labelId', IdParam) labelId: string,
    @Body(new ZodPipe(labelChangesSchema))
    body: LabelChangesBody,
  ): Promise<Label> {
    return this.labels.updateLabel(user.id, labelId, body);
  }

  // Admins only. Also takes the label off every card.
  @Delete('labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('labelId', IdParam) labelId: string,
  ): Promise<void> {
    return this.labels.deleteLabel(user.id, labelId);
  }

  @Get('cards/:cardId/labels')
  forCard(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<Label[]> {
    return this.labels.labelsForCard(user.id, cardId);
  }

  @Put('cards/:cardId/labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  addToCard(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Param('labelId', IdParam) labelId: string,
  ): Promise<void> {
    return this.labels.addLabelToCard(user.id, cardId, labelId);
  }

  @Delete('cards/:cardId/labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFromCard(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Param('labelId', IdParam) labelId: string,
  ): Promise<void> {
    return this.labels.removeLabelFromCard(user.id, cardId, labelId);
  }
}
