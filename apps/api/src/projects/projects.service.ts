import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { RelationColours } from '@tessera/shared';
import { Prisma, type Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  codeCandidates,
  isReservedProjectCode,
  normaliseProjectCode,
  suggestProjectCode,
} from './project-code.js';
import { localDate } from '../time/time-input.js';
import { requireAdmin } from './project-access.js';

export interface NewProject {
  name: string;
  description?: string;
  // 2 to 6 letters. Capitalised before saving.
  code: string;
}

// Every read here takes the user's id, so a user can only ever
// see projects they are a member of.
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // The project, its code record and the creator's admin membership are
  // saved together: if any fails, none is saved.
  async createProject(
    creatorId: string,
    project: NewProject,
  ): Promise<Project> {
    const code = requireValidCode(project.code);

    return this.withCodeConflictCheck(() =>
      this.prisma.project.create({
        data: {
          ...project,
          code,
          codes: { create: { code } },
          members: { create: { userId: creatorId, role: 'ADMIN' } },
        },
      }),
    );
  }

  // The first free code made from a project name, for the "new project" form.
  async suggestCode(name: string): Promise<string> {
    for (const candidate of codeCandidates(suggestProjectCode(name))) {
      if (isReservedProjectCode(candidate)) {
        continue;
      }
      const taken = await this.prisma.projectCode.findUnique({
        where: { code: candidate },
      });
      if (!taken) {
        return candidate;
      }
    }
    throw new ConflictException('No free project code could be found');
  }

  // Only admins can set the project's time zone, so everyone in the project
  // sees the same days. `timeZone` is an IANA name such as "Europe/London".
  async setTimeZone(
    userId: string,
    projectId: string,
    timeZone: string,
  ): Promise<Project> {
    localDate(new Date(), timeZone); // refuses an unknown time zone
    await requireAdmin(this.prisma, userId, projectId, 'change its time zone');
    return this.prisma.project.update({
      where: { id: projectId },
      data: { timeZone },
    });
  }

  // Only admins can set the colours that outline a selected card's
  // relatives, so everyone in the project sees the same ones
  // (docs/card-features.md, section 7). Relationships left out keep their
  // colour. The database checks the result.
  async setRelationColours(
    userId: string,
    projectId: string,
    changes: Partial<RelationColours>,
  ): Promise<Project> {
    await requireAdmin(
      this.prisma,
      userId,
      projectId,
      'change its relationship colours',
    );
    return this.prisma.$transaction(async (tx) => {
      // Locked, so two admins changing different colours keep both.
      const [current] = await tx.$queryRaw<
        { relationColours: RelationColours }[]
      >`SELECT relation_colours AS "relationColours" FROM projects
        WHERE id = ${projectId}::uuid FOR UPDATE`;
      return tx.project.update({
        where: { id: projectId },
        data: {
          relationColours: { ...current!.relationColours, ...changes },
        },
      });
    });
  }

  // Only admins can change a project's code. The old code is kept, so card
  // numbers that use it still lead to the card.
  async changeProjectCode(
    userId: string,
    projectId: string,
    newCode: string,
  ): Promise<Project> {
    const code = requireValidCode(newCode);
    await requireAdmin(this.prisma, userId, projectId, 'change its code');

    const existing = await this.prisma.projectCode.findUnique({
      where: { code },
    });
    if (existing && existing.projectId !== projectId) {
      throw codeTaken(code);
    }

    return this.withCodeConflictCheck(() =>
      this.prisma.project.update({
        where: { id: projectId },
        data: {
          code,
          // Already recorded when switching back to one of its own old codes.
          ...(existing ? {} : { codes: { create: { code } } }),
        },
      }),
    );
  }

  // Finds a project by its current code or any old one.
  async findProjectByCodeForUser(
    code: string,
    userId: string,
  ): Promise<Project | null> {
    const record = await this.prisma.projectCode.findUnique({
      where: { code: code.toUpperCase() },
      select: { projectId: true },
    });
    return record ? this.findProjectForUser(record.projectId, userId) : null;
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

  // Non-members are told the project is not found.
  // Two people may pick the same free code at the same moment; the database
  // refuses the second, and this turns that into a clear message.
  private async withCodeConflictCheck(
    save: () => Promise<Project>,
  ): Promise<Project> {
    try {
      return await save();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('That project code is already in use');
      }
      throw error;
    }
  }
}

function requireValidCode(code: string): string {
  const normalised = normaliseProjectCode(code);
  if (!normalised) {
    throw new BadRequestException(
      'A project code must be 2 to 6 letters, A to Z',
    );
  }
  if (isReservedProjectCode(normalised)) {
    throw new BadRequestException(
      `${normalised} can't be a project code, because /${normalised.toLowerCase()} is the server settings address`,
    );
  }
  return normalised;
}

function codeTaken(code: string): ConflictException {
  return new ConflictException(`The project code ${code} is already in use`);
}
