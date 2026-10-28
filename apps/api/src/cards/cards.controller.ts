import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Card } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type CardChangesBody,
  cardChangesSchema,
  type CompletionBody,
  completionSchema,
  type DeleteCardBody,
  deleteCardSchema,
  type MoveCardBody,
  moveCardSchema,
  type NewCardBody,
  newCardSchema,
} from './cards.schemas.js';
import {
  type CardView,
  CardsService,
  type CompleteCardResult,
} from './cards.service.js';

@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  // Goes to the bottom of the column, with the project's next number and
  // its own thread.
  @Post('columns/:columnId/cards')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('columnId', IdParam) columnId: string,
    @Body(new ZodPipe(newCardSchema)) body: NewCardBody,
  ): Promise<Card> {
    return this.cards.createCard(user.id, columnId, body);
  }

  // A number such as WEB-12 or WEB-12.1. Old numbers and codes work too.
  @Get('cards/by-number/:reference')
  async findByNumber(
    @CurrentUser() user: SignedInUser,
    @Param('reference') reference: string,
  ): Promise<CardView> {
    const card = await this.cards.findCardByNumber(
      user.id,
      reference.toUpperCase(),
    );
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return this.cards.toView(card);
  }

  @Get('cards/:cardId')
  find(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<CardView> {
    return this.cards.getCard(user.id, cardId);
  }

  // Any of title, description, priority, due and estimateMinutes. All are
  // checked before any is changed. Answers with the card as it now is.
  @Patch('cards/:cardId')
  async change(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(cardChangesSchema)) body: CardChangesBody,
  ): Promise<CardView> {
    await this.cards.updateCard(user.id, cardId, body);
    return this.cards.getCard(user.id, cardId);
  }

  // To the bottom of another column on the same board. Into a done column
  // completes the card; out of one reopens it. 409 with `openSubtasks`
  // when subtasks are open, unless confirmOpenSubtasks is true.
  @Post('cards/:cardId/move')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(moveCardSchema)) body: MoveCardBody,
  ): Promise<Card> {
    const { columnId, ...options } = body;
    return this.cards.moveCard(user.id, cardId, columnId, options);
  }

  // Also says which done column to offer moving the card to, if any.
  @Post('cards/:cardId/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(completionSchema)) body: CompletionBody,
  ): Promise<CompleteCardResult> {
    return this.cards.completeCard(user.id, cardId, body);
  }

  @Post('cards/:cardId/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
  ): Promise<Card> {
    return this.cards.reopenCard(user.id, cardId);
  }

  // The card's creator or an admin. A card with subtasks needs a choice for
  // each direct subtask in the body; a card with logged time gets 409.
  @Delete('cards/:cardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('cardId', IdParam) cardId: string,
    @Body(new ZodPipe(deleteCardSchema)) body: DeleteCardBody,
  ): Promise<void> {
    return this.cards.deleteCard(user.id, cardId, body?.subtasks ?? {});
  }
}
