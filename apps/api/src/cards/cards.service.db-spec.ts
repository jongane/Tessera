import { ConflictException, NotFoundException } from '@nestjs/common';
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

  // The ids of a column's cards, top to bottom.
  async function cardOrder(columnId: string): Promise<string[]> {
    const rows = await prisma.card.findMany({
      where: { columnId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async function movesRecorded(cardId: string): Promise<number> {
    return prisma.cardActivity.count({ where: { cardId, kind: 'MOVED' } });
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

    describe('for an existing thread', () => {
      async function topicThread(boardId: string, title = 'Release plan') {
        return prisma.thread.create({
          data: { boardId, kind: 'TOPIC', title },
        });
      }

      it('takes the thread as its own instead of making a new one', async () => {
        const { ana, board, toDo } = await setUp();
        const thread = await topicThread(board.id);

        const card = await cards.createCard(ana.id, toDo.id, {
          title: 'Plan the release',
          threadId: thread.id,
        });

        expect(
          await prisma.thread.findUnique({ where: { cardId: card.id } }),
        ).toMatchObject({ id: thread.id, title: 'Release plan' });
        expect(await prisma.thread.count({ where: { kind: 'TOPIC' } })).toBe(1);
      });

      it('refuses a thread already linked to a card, and saves nothing', async () => {
        const { ana, toDo } = await setUp();
        const first = await cards.createCard(ana.id, toDo.id, {
          title: 'Login page',
        });
        const taken = await prisma.thread.findUniqueOrThrow({
          where: { cardId: first.id },
        });

        await expect(
          cards.createCard(ana.id, toDo.id, {
            title: 'Sign-up page',
            threadId: taken.id,
          }),
        ).rejects.toThrow(ConflictException);
        expect(await prisma.card.count()).toBe(1);
      });

      it('refuses the board’s general thread', async () => {
        const { ana, board, toDo } = await setUp();
        const general = await prisma.thread.findFirstOrThrow({
          where: { boardId: board.id, kind: 'GENERAL' },
        });

        await expect(
          cards.createCard(ana.id, toDo.id, {
            title: 'Login page',
            threadId: general.id,
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('does not find a thread on another board', async () => {
        const { ana, project, toDo } = await setUp();
        const other = await boards.createBoard(ana.id, project.id, {
          name: 'Backlog',
        });
        const thread = await topicThread(other.id);

        await expect(
          cards.createCard(ana.id, toDo.id, {
            title: 'Login page',
            threadId: thread.id,
          }),
        ).rejects.toThrow(new NotFoundException('Thread not found'));
        expect(await prisma.card.count()).toBe(0);
      });

      it('lets only one of two new cards take the same thread', async () => {
        const { ana, board, toDo } = await setUp();
        const thread = await topicThread(board.id);

        const results = await Promise.allSettled([
          cards.createCard(ana.id, toDo.id, {
            title: 'A',
            threadId: thread.id,
          }),
          cards.createCard(ana.id, toDo.id, {
            title: 'B',
            threadId: thread.id,
          }),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual([
          'fulfilled',
          'rejected',
        ]);
        const refused = results.find((result) => result.status === 'rejected');
        expect(refused?.reason).toBeInstanceOf(ConflictException);
        expect(await prisma.card.count()).toBe(1);
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

    it('moves a card to a position in another column, 0 being the top', async () => {
      const { ana, toDo, inProgress } = await setUp();
      const a = await cards.createCard(ana.id, inProgress.id, { title: 'A' });
      const b = await cards.createCard(ana.id, inProgress.id, { title: 'B' });
      const card = await cards.createCard(ana.id, toDo.id, { title: 'New' });

      await cards.moveCard(ana.id, card.id, inProgress.id, { position: 1 });

      await expect(cardOrder(inProgress.id)).resolves.toEqual([
        a.id,
        card.id,
        b.id,
      ]);
    });

    it('reorders cards within their column', async () => {
      const { ana, toDo } = await setUp();
      const a = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      const b = await cards.createCard(ana.id, toDo.id, { title: 'B' });
      const c = await cards.createCard(ana.id, toDo.id, { title: 'C' });

      await cards.moveCard(ana.id, c.id, toDo.id, { position: 0 });
      await expect(cardOrder(toDo.id)).resolves.toEqual([c.id, a.id, b.id]);

      await cards.moveCard(ana.id, c.id, toDo.id, { position: 1 });
      await expect(cardOrder(toDo.id)).resolves.toEqual([a.id, c.id, b.id]);
    });

    it('puts the card last when the position is past the end', async () => {
      const { ana, toDo } = await setUp();
      const a = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      const b = await cards.createCard(ana.id, toDo.id, { title: 'B' });

      await cards.moveCard(ana.id, a.id, toDo.id, { position: 99 });

      await expect(cardOrder(toDo.id)).resolves.toEqual([b.id, a.id]);
    });

    it('records a move between columns, but not a reorder within one', async () => {
      const { ana, toDo, inProgress } = await setUp();
      const a = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      await cards.createCard(ana.id, toDo.id, { title: 'B' });

      await cards.moveCard(ana.id, a.id, toDo.id, { position: 1 });
      await expect(movesRecorded(a.id)).resolves.toBe(0);

      await cards.moveCard(ana.id, a.id, inProgress.id, { position: 0 });
      await expect(movesRecorded(a.id)).resolves.toBe(1);
    });

    it('keeps the order when two cards are moved at the same moment', async () => {
      const { ana, toDo, inProgress } = await setUp();
      const a = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      const b = await cards.createCard(ana.id, toDo.id, { title: 'B' });
      const c = await cards.createCard(ana.id, inProgress.id, { title: 'C' });

      await Promise.all([
        cards.moveCard(ana.id, a.id, inProgress.id, { position: 0 }),
        cards.moveCard(ana.id, b.id, inProgress.id, { position: 0 }),
      ]);

      const order = await cardOrder(inProgress.id);
      expect(order).toHaveLength(3);
      expect(new Set(order)).toEqual(new Set([a.id, b.id, c.id]));
      const positions = await prisma.card.findMany({
        where: { columnId: inProgress.id },
        orderBy: { position: 'asc' },
        select: { position: true },
      });
      expect(positions.map((p) => p.position)).toEqual([0, 1, 2]);
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

  describe('card numbers', () => {
    it('numbers cards 1, 2, 3 across all boards in a project', async () => {
      const { ana, project, toDo } = await setUp();
      const otherBoard = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 2',
      });
      const otherColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: otherBoard.id },
      });

      const first = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      const second = await cards.createCard(ana.id, otherColumn.id, {
        title: 'B',
      });
      const third = await cards.createCard(ana.id, toDo.id, { title: 'C' });

      expect([first, second, third].map((c) => c.numberPath)).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    it('gives cards created at the same moment different numbers', async () => {
      const { ana, toDo } = await setUp();

      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          cards.createCard(ana.id, toDo.id, { title: `Card ${i}` }),
        ),
      );

      const numbers = created.map((c) => Number(c.numberPath));
      expect(new Set(numbers).size).toBe(10);
      expect(Math.max(...numbers)).toBe(10);
    });

    it('never reuses the number of a deleted card', async () => {
      const { ana, toDo } = await setUp();
      const first = await cards.createCard(ana.id, toDo.id, { title: 'A' });
      await cards.deleteCard(ana.id, first.id);

      const next = await cards.createCard(ana.id, toDo.id, { title: 'B' });

      expect(next.numberPath).toBe('2');
    });
  });

  describe('findCardByNumber', () => {
    async function setUpWithCard() {
      const setup = await setUp();
      const card = await cards.createCard(setup.ana.id, setup.toDo.id, {
        title: 'Login page',
      });
      return { ...setup, card };
    }

    it('finds a card by its number, in any letter case', async () => {
      const { ana, project, card } = await setUpWithCard();

      await expect(
        cards.findCardByNumber(ana.id, `${project.code}-1`),
      ).resolves.toMatchObject({ id: card.id });
      await expect(
        cards.findCardByNumber(ana.id, `${project.code.toLowerCase()}-1`),
      ).resolves.toMatchObject({ id: card.id });
    });

    it("finds a card by its project's old code", async () => {
      const { ana, project, card } = await setUpWithCard();
      const oldCode = project.code;
      await prisma.project.update({
        where: { id: project.id },
        data: { code: 'NEW', codes: { create: { code: 'NEW' } } },
      });

      await expect(
        cards.findCardByNumber(ana.id, `${oldCode}-1`),
      ).resolves.toMatchObject({ id: card.id });
    });

    it('finds nothing for an unknown number, a badly formed one, or a non-member', async () => {
      const { ana, ben, project } = await setUpWithCard();

      await expect(
        cards.findCardByNumber(ana.id, `${project.code}-99`),
      ).resolves.toBeNull();
      await expect(
        cards.findCardByNumber(ana.id, 'not a number'),
      ).resolves.toBeNull();
      await expect(
        cards.findCardByNumber(ben.id, `${project.code}-1`),
      ).resolves.toBeNull();
    });
  });
});
