import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';
import { BoardsModule } from '../boards/boards.module.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [BoardsModule],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
