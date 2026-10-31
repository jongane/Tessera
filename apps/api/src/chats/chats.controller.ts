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
import type { Chat } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { BoardsService } from '../boards/boards.service.js';
import {
  type NewChatBody,
  newChatSchema,
  type ChatLink,
  chatLinkSchema,
} from '@tessera/shared';
import { ChatsService } from './chats.service.js';

@Controller()
export class ChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly boards: BoardsService,
  ) {}

  // The general chat first, then the others oldest first.
  @Get('boards/:boardId/chats')
  async list(
    @CurrentUser() user: SignedInUser,
    @Param('boardId', IdParam) boardId: string,
  ): Promise<Chat[]> {
    if (!(await this.boards.findBoardForUser(boardId, user.id))) {
      throw new NotFoundException('Board not found');
    }
    return this.chats.listChatsForBoard(user.id, boardId);
  }

  // A chat on its own, not linked to a card.
  @Post('boards/:boardId/chats')
  create(
    @CurrentUser() user: SignedInUser,
    @Param('boardId', IdParam) boardId: string,
    @Body(new ZodPipe(newChatSchema)) body: NewChatBody,
  ): Promise<Chat> {
    return this.chats.createChat(user.id, boardId, body);
  }

  // Links the chat to a card on the same board.
  @Put('chats/:chatId/card')
  link(
    @CurrentUser() user: SignedInUser,
    @Param('chatId', IdParam) chatId: string,
    @Body(new ZodPipe(chatLinkSchema)) body: ChatLink,
  ): Promise<Chat> {
    return this.chats.linkChatToCard(user.id, chatId, body.cardId);
  }

  // Removes the link; the chat and the card are both kept.
  @Delete('chats/:chatId/card')
  unlink(
    @CurrentUser() user: SignedInUser,
    @Param('chatId', IdParam) chatId: string,
  ): Promise<Chat> {
    return this.chats.unlinkChat(user.id, chatId);
  }
}
