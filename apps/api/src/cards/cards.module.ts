import { Module } from '@nestjs/common';
import { AssigneesService } from './assignees.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';

@Module({
  providers: [CardsService, SubtasksService, AssigneesService],
  exports: [CardsService, SubtasksService, AssigneesService],
})
export class CardsModule {}
