import { Module } from '@nestjs/common';
import { BoardsController } from './boards.controller.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { BoardsService } from './boards.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
