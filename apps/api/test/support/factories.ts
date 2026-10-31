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

// Project codes for test projects: TAA, TAB, TAC, ...
let projectCount = 0;
function nextTestCode(): string {
  const n = projectCount++;
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));
  return 'T' + letter(Math.floor(n / 26)) + letter(n);
}

// A project with `adminId` as its admin. Its code is also registered in
// project_codes, as ProjectsService.createProject does.
export function createProject(
  prisma: PrismaService,
  adminId: string,
  name = 'Website',
  code = nextTestCode(),
) {
  return prisma.project.create({
    data: {
      name,
      code,
      codes: { create: { code } },
      members: { create: { userId: adminId, role: 'ADMIN' } },
    },
  });
}

// A bare board with one column and no chats, for tests of the
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

// A bare card with no chat, for tests of the database rules. It takes the
// next number from its project's counter, as CardsService.createCard does.
export async function createBareCard(
  prisma: PrismaService,
  card: {
    boardId: string;
    columnId: string;
    title?: string;
  },
) {
  const board = await prisma.board.findUniqueOrThrow({
    where: { id: card.boardId },
  });
  const project = await prisma.project.update({
    where: { id: board.projectId },
    data: { nextCardNumber: { increment: 1 } },
  });
  return prisma.card.create({
    data: {
      title: 'Login page',
      ...card,
      projectId: board.projectId,
      numberPath: String(project.nextCardNumber - 1),
      position: 0,
    },
  });
}

// A bare subtask of `parent`, numbered from the parent's subtask counter, as
// SubtasksService.createSubtask does. It sits in the parent's column.
export async function createBareSubtask(
  prisma: PrismaService,
  parent: {
    id: string;
    projectId: string;
    boardId: string;
    columnId: string;
    numberPath: string;
    depth: number;
  },
) {
  const updated = await prisma.card.update({
    where: { id: parent.id },
    data: { nextSubtaskNumber: { increment: 1 } },
  });
  return prisma.card.create({
    data: {
      title: 'Subtask',
      projectId: parent.projectId,
      boardId: parent.boardId,
      columnId: parent.columnId,
      parentId: parent.id,
      depth: parent.depth + 1,
      numberPath: `${parent.numberPath}.${updated.nextSubtaskNumber - 1}`,
      position: 0,
    },
  });
}
