import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BoardsModule } from './boards/boards.module.js';
import { CardsModule } from './cards/cards.module.js';
import { ChecklistsModule } from './checklists/checklists.module.js';
import { LabelsModule } from './labels/labels.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ThreadsModule } from './threads/threads.module.js';
import { TimeModule } from './time/time.module.js';

@Module({
  imports: [
    PrismaModule,
    ProjectsModule,
    ActivityModule,
    BoardsModule,
    CardsModule,
    ChecklistsModule,
    LabelsModule,
    ThreadsModule,
    TimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
