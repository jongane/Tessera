import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type MessageBodyRequest,
  type MessagePageQuery,
  messageBodyRequestSchema,
  messagePageQuerySchema,
} from '@tessera/shared';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type MessagePageView,
  type MessageView,
  MessagesService,
} from './messages.service.js';

@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // The newest 50 messages, or the 50 before `before`, oldest first.
  @Get('chats/:chatId/messages')
  list(
    @CurrentUser() user: SignedInUser,
    @Param('chatId', IdParam) chatId: string,
    @Query(new ZodPipe(messagePageQuerySchema)) query: MessagePageQuery,
  ): Promise<MessagePageView> {
    return this.messages.listMessages(user.id, chatId, query.before);
  }

  @Post('chats/:chatId/messages')
  send(
    @CurrentUser() user: SignedInUser,
    @Param('chatId', IdParam) chatId: string,
    @Body(new ZodPipe(messageBodyRequestSchema)) body: MessageBodyRequest,
  ): Promise<MessageView> {
    return this.messages.sendMessage(user.id, chatId, body.body);
  }

  @Patch('messages/:messageId')
  edit(
    @CurrentUser() user: SignedInUser,
    @Param('messageId', IdParam) messageId: string,
    @Body(new ZodPipe(messageBodyRequestSchema)) body: MessageBodyRequest,
  ): Promise<MessageView> {
    return this.messages.editMessage(user.id, messageId, body.body);
  }

  @Delete('messages/:messageId')
  remove(
    @CurrentUser() user: SignedInUser,
    @Param('messageId', IdParam) messageId: string,
  ): Promise<MessageView> {
    return this.messages.deleteMessage(user.id, messageId);
  }
}
