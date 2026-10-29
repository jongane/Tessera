import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Project } from '../generated/prisma/client.js';
import { CurrentUser, type SignedInUser } from '../auth/signed-in-user.js';
import { IdParam } from '../common/id-param.js';
import { ZodPipe } from '../common/zod-pipe.js';
import {
  type NewProjectBody,
  newProjectSchema,
  type ProjectChanges,
  projectChangesSchema,
  type SuggestCodeQuery,
  suggestCodeQuerySchema,
} from '@tessera/shared';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // The projects the signed-in person is a member of, by name.
  @Get()
  list(@CurrentUser() user: SignedInUser): Promise<Project[]> {
    return this.projects.listProjectsForUser(user.id);
  }

  // The person who creates a project becomes its admin.
  @Post()
  create(
    @CurrentUser() user: SignedInUser,
    @Body(new ZodPipe(newProjectSchema)) body: NewProjectBody,
  ): Promise<Project> {
    return this.projects.createProject(user.id, body);
  }

  // For the "new project" form: the first free code made from a name.
  @Get('suggest-code')
  async suggestCode(
    @Query(new ZodPipe(suggestCodeQuerySchema)) query: SuggestCodeQuery,
  ): Promise<{ code: string }> {
    return { code: await this.projects.suggestCode(query.name) };
  }

  // Old codes work too.
  @Get('by-code/:code')
  async findByCode(
    @CurrentUser() user: SignedInUser,
    @Param('code') code: string,
  ): Promise<Project> {
    return found(await this.projects.findProjectByCodeForUser(code, user.id));
  }

  @Get(':projectId')
  async find(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
  ): Promise<Project> {
    return found(await this.projects.findProjectForUser(projectId, user.id));
  }

  // Admins only. The time zone is checked before anything is changed.
  @Patch(':projectId')
  async change(
    @CurrentUser() user: SignedInUser,
    @Param('projectId', IdParam) projectId: string,
    @Body(new ZodPipe(projectChangesSchema)) body: ProjectChanges,
  ): Promise<Project> {
    if (body.timeZone !== undefined) {
      await this.projects.setTimeZone(user.id, projectId, body.timeZone);
    }
    if (body.code !== undefined) {
      await this.projects.changeProjectCode(user.id, projectId, body.code);
    }
    return found(await this.projects.findProjectForUser(projectId, user.id));
  }
}

function found(project: Project | null): Project {
  if (!project) {
    throw new NotFoundException('Project not found');
  }
  return project;
}
