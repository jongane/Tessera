import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from './boards.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createProject, createUser } from '../../test/support/factories.js';

describe('BoardsService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const project = await createProject(prisma, ana.id);
    return { ana, ben, project };
  }

  describe('createBoard', () => {
    it('starts a board with To do, In progress and Done columns', async () => {
      const { ana, project } = await setUp();

      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });

      const columns = await prisma.column.findMany({
        where: { boardId: board.id },
        orderBy: { position: 'asc' },
      });
      expect(columns.map((c) => c.name)).toEqual([
        'To do',
        'In progress',
        'Done',
      ]);
    });

    it('marks only the Done column as a done column', async () => {
      const { ana, project } = await setUp();

      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });

      const columns = await prisma.column.findMany({
        where: { boardId: board.id },
        orderBy: { position: 'asc' },
      });
      expect(columns.map((c) => c.isDone)).toEqual([false, false, true]);
    });

    it('gives the board one general chat with no card', async () => {
      const { ana, project } = await setUp();

      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });

      const chats = await prisma.chat.findMany({
        where: { boardId: board.id },
      });
      expect(chats).toHaveLength(1);
      expect(chats[0]).toMatchObject({
        kind: 'GENERAL',
        title: 'General',
        cardId: null,
      });
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, project } = await setUp();

      await expect(
        boards.createBoard(ben.id, project.id, { name: 'Sprint 1' }),
      ).rejects.toThrow(NotFoundException);
      await expect(prisma.board.count()).resolves.toBe(0);
    });
  });

  describe('listBoardsForProject', () => {
    it("lists a project's boards for a member", async () => {
      const { ana, project } = await setUp();
      await boards.createBoard(ana.id, project.id, { name: 'Sprint 1' });
      await boards.createBoard(ana.id, project.id, { name: 'Backlog' });

      const list = await boards.listBoardsForProject(ana.id, project.id);

      expect(list.map((b) => b.name)).toEqual(['Backlog', 'Sprint 1']);
    });

    it('lists nothing for someone who is not a member', async () => {
      const { ana, ben, project } = await setUp();
      await boards.createBoard(ana.id, project.id, { name: 'Sprint 1' });

      await expect(
        boards.listBoardsForProject(ben.id, project.id),
      ).resolves.toEqual([]);
    });
  });

  describe('findBoardForUser', () => {
    it('finds a board only for members of its project', async () => {
      const { ana, ben, project } = await setUp();
      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });

      await expect(
        boards.findBoardForUser(board.id, ana.id),
      ).resolves.toMatchObject({ name: 'Sprint 1' });
      await expect(
        boards.findBoardForUser(board.id, ben.id),
      ).resolves.toBeNull();
    });
  });

  describe('setColumnDone', () => {
    it('marks and unmarks a done column', async () => {
      const { ana, project } = await setUp();
      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });
      const toDo = await prisma.column.findFirstOrThrow({
        where: { boardId: board.id, position: 0 },
      });

      await expect(
        boards.setColumnDone(ana.id, toDo.id, true),
      ).resolves.toMatchObject({ isDone: true });
      await expect(
        boards.setColumnDone(ana.id, toDo.id, false),
      ).resolves.toMatchObject({ isDone: false });
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ana, ben, project } = await setUp();
      const board = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 1',
      });
      const toDo = await prisma.column.findFirstOrThrow({
        where: { boardId: board.id, position: 0 },
      });

      await expect(boards.setColumnDone(ben.id, toDo.id, true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
