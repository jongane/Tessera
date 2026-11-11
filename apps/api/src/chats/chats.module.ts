import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';
import { BoardsModule } from '../boards/boards.module.js';
import { ChatsService } from './chats.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [BoardsModule],
  controllers: [ChatsController, MessagesController],
  providers: [ChatsService, MessagesService],
  exports: [ChatsService],
})
export class ChatsModule {}
