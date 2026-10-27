import { Module } from '@nestjs/common';
import { BoardsService } from './boards.service.js';

@Module({
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
