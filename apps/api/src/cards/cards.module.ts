import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { AssigneesController } from './assignees.controller.js';
import { SubtasksController } from './subtasks.controller.js';
import { CardsController } from './cards.controller.js';
import { AssigneesService } from './assignees.service.js';
import { CardsService } from './cards.service.js';
import { CardSearchService } from './card-search.service.js';
import { SubtasksService } from './subtasks.service.js';

@Module({
  imports: [FilesModule],
  controllers: [SubtasksController, AssigneesController, CardsController],
  providers: [
    CardsService,
    SubtasksService,
    AssigneesService,
    CardSearchService,
  ],
  exports: [CardsService, SubtasksService, AssigneesService],
})
export class CardsModule {}
