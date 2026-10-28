import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BoardsModule } from './boards/boards.module.js';
import { CardsModule } from './cards/cards.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ThreadsModule } from './threads/threads.module.js';
import { TimeModule } from './time/time.module.js';

@Module({
  imports: [
    PrismaModule,
    ProjectsModule,
    BoardsModule,
    CardsModule,
    ThreadsModule,
    TimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
