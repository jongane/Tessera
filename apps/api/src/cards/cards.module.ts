import { Module } from '@nestjs/common';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';

@Module({
  providers: [CardsService, SubtasksService],
  exports: [CardsService, SubtasksService],
})
export class CardsModule {}
