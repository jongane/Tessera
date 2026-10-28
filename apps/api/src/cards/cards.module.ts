import { Module } from '@nestjs/common';
import { AssigneesController } from './assignees.controller.js';
import { SubtasksController } from './subtasks.controller.js';
import { CardsController } from './cards.controller.js';
import { AssigneesService } from './assignees.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';

@Module({
  controllers: [SubtasksController, AssigneesController, CardsController],
  providers: [CardsService, SubtasksService, AssigneesService],
  exports: [CardsService, SubtasksService, AssigneesService],
})
export class CardsModule {}
