import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from './cards.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createProject, createUser } from '../../test/support/factories.js';

describe('CardsService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // A project owned by Ana with one board. Ben is not a member.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const project = await createProject(prisma, ana.id);
    const board = await boards.createBoard(ana.id, project.id, {
      name: 'Sprint 1',
    });
    const [toDo, inProgress] = await prisma.column.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return { ana, ben, project, board, toDo: toDo!, inProgress: inProgress! };
  }

  describe('createCard', () => {
    it('creates the card with its own thread', async () => {
      const { ana, board, toDo } = await setUp();

      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
        description: 'As a user I can sign in',
      });

      expect(card).toMatchObject({
        boardId: board.id,
        columnId: toDo.id,
        title: 'Login page',
        description: 'As a user I can sign in',
      });
      const thread = await prisma.thread.findUnique({
        where: { cardId: card.id },
      });
      expect(thread).toMatchObject({
        boardId: board.id,
        kind: 'TOPIC',
        title: 'Login page',
      });
    });

    it('adds new cards to the bottom of the column', async () => {
      const { ana, toDo } = await setUp();

      const first = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      const second = await cards.createCard(ana.id, toDo.id, { title: 'B' });

      expect(second.position).toBeGreaterThan(first.position);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, toDo } = await setUp();

      await expect(
        cards.createCard(ben.id, toDo.id, { title: 'Login page' }),
      ).rejects.toThrow(NotFoundException);
      await expect(prisma.card.count()).resolves.toBe(0);
    });
  });

  describe('moveCard', () => {
    it('moves a card to the bottom of another column on its board', async () => {
      const { ana, toDo, inProgress } = await setUp();
      const waiting = await cards.createCard(ana.id, inProgress.id, {
        title: 'Already started',
      });
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });

      const moved = await cards.moveCard(ana.id, card.id, inProgress.id);

      expect(moved.columnId).toBe(inProgress.id);
      expect(moved.position).toBeGreaterThan(waiting.position);
    });

    it('refuses a column on another board', async () => {
      const { ana, project, toDo } = await setUp();
      const otherBoard = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 2',
      });
      const otherColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: otherBoard.id },
      });
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });

      await expect(
        cards.moveCard(ana.id, card.id, otherColumn.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ana, ben, toDo, inProgress } = await setUp();
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });

      await expect(
        cards.moveCard(ben.id, card.id, inProgress.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCard', () => {
    it('deletes the card but keeps its thread, unlinked', async () => {
      const { ana, toDo } = await setUp();
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });
      const thread = await prisma.thread.findUniqueOrThrow({
        where: { cardId: card.id },
      });

      await cards.deleteCard(ana.id, card.id);

      await expect(
        prisma.card.findUnique({ where: { id: card.id } }),
      ).resolves.toBeNull();
      await expect(
        prisma.thread.findUnique({ where: { id: thread.id } }),
      ).resolves.toMatchObject({ cardId: null, title: 'Login page' });
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ana, ben, toDo } = await setUp();
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });

      await expect(cards.deleteCard(ben.id, card.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(prisma.card.count()).resolves.toBe(1);
    });
  });
});
