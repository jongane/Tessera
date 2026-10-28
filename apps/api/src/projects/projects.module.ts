import { Module } from '@nestjs/common';
import { MembersController } from './members.controller.js';
import { ProjectsController } from './projects.controller.js';
import { MembersService } from './members.service.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController, MembersController],
  providers: [ProjectsService, MembersService],
  exports: [ProjectsService, MembersService],
})
export class ProjectsModule {}
