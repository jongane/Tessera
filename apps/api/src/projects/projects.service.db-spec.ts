import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from './projects.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';

describe('ProjectsService (database)', () => {
  let prisma: PrismaService;
  let projects: ProjectsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [ProjectsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    projects = moduleRef.get(ProjectsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function createUser(name: string) {
    return prisma.user.create({
      data: {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: 'not-a-real-hash',
      },
    });
  }

  it('makes the person who creates a project its admin', async () => {
    const ana = await createUser('ana');

    const project = await projects.createProject(ana.id, {
      name: 'Website',
      code: 'WEB',
    });

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: ana.id } },
    });
    expect(membership?.role).toBe('ADMIN');
  });

  it('lists only the projects a user belongs to', async () => {
    const ana = await createUser('ana');
    const ben = await createUser('ben');
    await projects.createProject(ana.id, { name: 'Website', code: 'WEB' });
    await projects.createProject(ben.id, { name: 'Mobile app', code: 'MA' });

    const anasProjects = await projects.listProjectsForUser(ana.id);

    expect(anasProjects.map((p) => p.name)).toEqual(['Website']);
  });

  it('does not find a project for someone who is not a member', async () => {
    const ana = await createUser('ana');
    const ben = await createUser('ben');
    const project = await projects.createProject(ana.id, {
      name: 'Website',
      code: 'WEB',
    });

    await expect(
      projects.findProjectForUser(project.id, ana.id),
    ).resolves.toMatchObject({ name: 'Website' });
    await expect(
      projects.findProjectForUser(project.id, ben.id),
    ).resolves.toBeNull();
  });

  it('refuses to add the same person to a project twice', async () => {
    const ana = await createUser('ana');
    const project = await projects.createProject(ana.id, {
      name: 'Website',
      code: 'WEB',
    });

    await expect(
      prisma.projectMember.create({
        data: { projectId: project.id, userId: ana.id },
      }),
    ).rejects.toThrow();
  });

  it('refuses two accounts with the same email', async () => {
    await createUser('ana');

    await expect(createUser('ana')).rejects.toThrow();
  });

  describe('project codes', () => {
    it('saves the code, capitalised, and records it', async () => {
      const ana = await createUser('ana');

      const project = await projects.createProject(ana.id, {
        name: 'Website',
        code: ' web ',
      });

      expect(project.code).toBe('WEB');
      await expect(
        prisma.projectCode.findUnique({ where: { code: 'WEB' } }),
      ).resolves.toMatchObject({ projectId: project.id });
    });

    it('refuses a badly formed code', async () => {
      const ana = await createUser('ana');

      await expect(
        projects.createProject(ana.id, { name: 'Website', code: 'W3B' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a code another project has, or once had', async () => {
      const ana = await createUser('ana');
      const website = await projects.createProject(ana.id, {
        name: 'Website',
        code: 'WEB',
      });
      await projects.changeProjectCode(ana.id, website.id, 'SITE');

      await expect(
        projects.createProject(ana.id, { name: 'Web shop', code: 'SITE' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        projects.createProject(ana.id, { name: 'Web shop', code: 'WEB' }),
      ).rejects.toThrow(ConflictException);
      await expect(prisma.project.count()).resolves.toBe(1);
    });

    it('suggests a free code from the name', async () => {
      const ana = await createUser('ana');
      await expect(projects.suggestCode('Website')).resolves.toBe('WEB');

      await projects.createProject(ana.id, { name: 'Website', code: 'WEB' });

      await expect(projects.suggestCode('Website')).resolves.toBe('WEBA');
    });
  });

  describe('changeProjectCode', () => {
    async function setUp() {
      const ana = await createUser('ana');
      const ben = await createUser('ben');
      const cat = await createUser('cat');
      const project = await projects.createProject(ana.id, {
        name: 'Website',
        code: 'WEB',
      });
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: ben.id, role: 'MEMBER' },
      });
      return { ana, ben, cat, project };
    }

    it('lets an admin change the code, and the old code still finds the project', async () => {
      const { ana, project } = await setUp();

      const changed = await projects.changeProjectCode(
        ana.id,
        project.id,
        'site',
      );

      expect(changed.code).toBe('SITE');
      await expect(
        projects.findProjectByCodeForUser('WEB', ana.id),
      ).resolves.toMatchObject({ id: project.id });
      await expect(
        projects.findProjectByCodeForUser('SITE', ana.id),
      ).resolves.toMatchObject({ id: project.id });
    });

    it('lets a project switch back to one of its own old codes', async () => {
      const { ana, project } = await setUp();
      await projects.changeProjectCode(ana.id, project.id, 'SITE');

      const changed = await projects.changeProjectCode(
        ana.id,
        project.id,
        'WEB',
      );

      expect(changed.code).toBe('WEB');
    });

    it('refuses a member who is not an admin', async () => {
      const { ben, project } = await setUp();

      await expect(
        projects.changeProjectCode(ben.id, project.id, 'SITE'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses someone who is not a member', async () => {
      const { cat, project } = await setUp();

      await expect(
        projects.changeProjectCode(cat.id, project.id, 'SITE'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findProjectByCodeForUser', () => {
    it('finds nothing for someone who is not a member', async () => {
      const ana = await createUser('ana');
      const ben = await createUser('ben');
      await projects.createProject(ana.id, { name: 'Website', code: 'WEB' });

      await expect(
        projects.findProjectByCodeForUser('WEB', ben.id),
      ).resolves.toBeNull();
    });
  });

  describe('setTimeZone', () => {
    async function setUp() {
      const ana = await createUser('ana');
      const ben = await createUser('ben');
      const cat = await createUser('cat');
      const project = await projects.createProject(ana.id, {
        name: 'Website',
        code: 'WEB',
      });
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: ben.id, role: 'MEMBER' },
      });
      return { ana, ben, cat, project };
    }

    it('starts new projects on UTC and lets an admin change it', async () => {
      const { ana, project } = await setUp();
      expect(project.timeZone).toBe('UTC');

      await expect(
        projects.setTimeZone(ana.id, project.id, 'Australia/Sydney'),
      ).resolves.toMatchObject({ timeZone: 'Australia/Sydney' });
    });

    it('refuses a time zone that does not exist', async () => {
      const { ana, project } = await setUp();

      await expect(
        projects.setTimeZone(ana.id, project.id, 'Mars/Olympus'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a member who is not an admin, and a non-member', async () => {
      const { ben, cat, project } = await setUp();

      await expect(
        projects.setTimeZone(ben.id, project.id, 'Europe/London'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        projects.setTimeZone(cat.id, project.id, 'Europe/London'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
