import { Module } from '@nestjs/common';
import { CardsController } from './cards.controller.js';
import { AssigneesService } from './assignees.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';

@Module({
  controllers: [CardsController],
  providers: [CardsService, SubtasksService, AssigneesService],
  exports: [CardsService, SubtasksService, AssigneesService],
})
export class CardsModule {}
