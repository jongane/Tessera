import { Injectable } from '@nestjs/common';
import type { Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewProject {
  name: string;
  description?: string;
}

// Every read here takes the user's id, so a user can only ever
// see projects they are a member of.
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // The project and the creator's admin membership are saved together:
  // if either fails, neither is saved.
  createProject(creatorId: string, project: NewProject): Promise<Project> {
    return this.prisma.project.create({
      data: {
        ...project,
        members: { create: { userId: creatorId, role: 'ADMIN' } },
      },
    });
  }

  listProjectsForUser(userId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { members: { some: { userId } } },
      orderBy: { name: 'asc' },
    });
  }

  // Returns null both when the project does not exist and when the user
  // is not a member, so callers cannot tell the two apart.
  findProjectForUser(
    projectId: string,
    userId: string,
  ): Promise<Project | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, members: { some: { userId } } },
    });
  }
}
