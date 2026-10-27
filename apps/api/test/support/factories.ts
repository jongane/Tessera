import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Small helpers that put rows straight into the database, so a test can
// set up what it needs without going through the code under test.

export function createUser(prisma: PrismaService, name: string) {
  return prisma.user.create({
    data: {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: 'not-a-real-hash',
    },
  });
}

// A project with `adminId` as its admin.
export function createProject(
  prisma: PrismaService,
  adminId: string,
  name = 'Website',
) {
  return prisma.project.create({
    data: { name, members: { create: { userId: adminId, role: 'ADMIN' } } },
  });
}

// A bare board with one column and no threads, for tests of the
// database rules. Real boards are made by BoardsService.createBoard.
export async function createBareBoard(
  prisma: PrismaService,
  projectId: string,
  name = 'Sprint 1',
) {
  const board = await prisma.board.create({ data: { projectId, name } });
  const column = await prisma.column.create({
    data: { boardId: board.id, name: 'To do', position: 0 },
  });
  return { board, column };
}
