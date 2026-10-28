import { Module } from '@nestjs/common';
import { ThreadsController } from './threads.controller.js';
import { BoardsModule } from '../boards/boards.module.js';
import { ThreadsService } from './threads.service.js';

@Module({
  imports: [BoardsModule],
  controllers: [ThreadsController],
  providers: [ThreadsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
