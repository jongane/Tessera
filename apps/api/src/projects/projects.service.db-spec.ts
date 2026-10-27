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

    const project = await projects.createProject(ana.id, { name: 'Website' });

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: ana.id } },
    });
    expect(membership?.role).toBe('ADMIN');
  });

  it('lists only the projects a user belongs to', async () => {
    const ana = await createUser('ana');
    const ben = await createUser('ben');
    await projects.createProject(ana.id, { name: 'Website' });
    await projects.createProject(ben.id, { name: 'Mobile app' });

    const anasProjects = await projects.listProjectsForUser(ana.id);

    expect(anasProjects.map((p) => p.name)).toEqual(['Website']);
  });

  it('does not find a project for someone who is not a member', async () => {
    const ana = await createUser('ana');
    const ben = await createUser('ben');
    const project = await projects.createProject(ana.id, { name: 'Website' });

    await expect(
      projects.findProjectForUser(project.id, ana.id),
    ).resolves.toMatchObject({ name: 'Website' });
    await expect(
      projects.findProjectForUser(project.id, ben.id),
    ).resolves.toBeNull();
  });

  it('refuses to add the same person to a project twice', async () => {
    const ana = await createUser('ana');
    const project = await projects.createProject(ana.id, { name: 'Website' });

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
});
