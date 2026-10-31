import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createProject, createUser } from '../../test/support/factories.js';

describe('SubtasksService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, SubtasksService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Project WEB, owned by Ana, with one board and cards WEB-1 and WEB-2.
  // Ben is not a member.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const board = await boards.createBoard(ana.id, project.id, {
      name: 'Sprint 1',
    });
    const toDo = await prisma.column.findFirstOrThrow({
      where: { boardId: board.id, position: 0 },
    });
    const one = await cards.createCard(ana.id, toDo.id, { title: 'Login' });
    const two = await cards.createCard(ana.id, toDo.id, { title: 'Sign-up' });
    return { ana, ben, project, board, toDo, one, two };
  }

  function numberOf(cardId: string) {
    return prisma.card
      .findUniqueOrThrow({ where: { id: cardId } })
      .then((card) => card.numberPath);
  }

  describe('createSubtask', () => {
    it('numbers subtasks under their parent, each with its own chat', async () => {
      const { ana, one, toDo } = await setUp();

      const first = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      const second = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Errors',
      });
      const deeper = await subtasks.createSubtask(ana.id, first.id, toDo.id, {
        title: 'Validation',
      });

      expect(first).toMatchObject({
        numberPath: '1.1',
        parentId: one.id,
        depth: 1,
      });
      expect(second.numberPath).toBe('1.2');
      expect(deeper).toMatchObject({ numberPath: '1.1.1', depth: 2 });
      await expect(
        prisma.chat.findUnique({ where: { cardId: deeper.id } }),
      ).resolves.toMatchObject({ title: 'Validation' });
    });

    it('can put a subtask on another board in the same project', async () => {
      const { ana, project, one } = await setUp();
      const design = await boards.createBoard(ana.id, project.id, {
        name: 'Design',
      });
      const designColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: design.id },
      });

      const logo = await subtasks.createSubtask(
        ana.id,
        one.id,
        designColumn.id,
        { title: 'Logo' },
      );

      expect(logo).toMatchObject({ boardId: design.id, numberPath: '1.1' });
    });

    it('refuses a column in another project', async () => {
      const { ana, one } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');
      const mobileBoard = await boards.createBoard(ana.id, mobile.id, {
        name: 'Sprint 1',
      });
      const mobileColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: mobileBoard.id },
      });

      await expect(
        subtasks.createSubtask(ana.id, one.id, mobileColumn.id, {
          title: 'Form',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to go deeper than 5 levels', async () => {
      const { ana, one, toDo } = await setUp();
      let level = one;
      for (let depth = 1; depth <= 4; depth++) {
        level = await subtasks.createSubtask(ana.id, level.id, toDo.id, {
          title: `Level ${depth}`,
        });
      }

      await expect(
        subtasks.createSubtask(ana.id, level.id, toDo.id, {
          title: 'Too deep',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('never reuses the number of a deleted subtask', async () => {
      const { ana, one, toDo } = await setUp();
      const first = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      await cards.deleteCard(ana.id, first.id);

      const next = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form again',
      });

      expect(next.numberPath).toBe('1.2');
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one, toDo } = await setUp();

      await expect(
        subtasks.createSubtask(ben.id, one.id, toDo.id, { title: 'Form' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('moveToParent', () => {
    it('renumbers the subtask and everything below it, and keeps the old numbers working', async () => {
      const { ana, one, two, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      const validation = await subtasks.createSubtask(
        ana.id,
        form.id,
        toDo.id,
        { title: 'Validation' },
      );

      const moved = await subtasks.moveToParent(ana.id, form.id, two.id);

      expect(moved).toMatchObject({
        parentId: two.id,
        numberPath: '2.1',
        depth: 1,
      });
      await expect(numberOf(validation.id)).resolves.toBe('2.1.1');
      await expect(
        cards.findCardByNumber(ana.id, 'WEB-1.1'),
      ).resolves.toMatchObject({ id: form.id });
      await expect(
        cards.findCardByNumber(ana.id, 'WEB-1.1.1'),
      ).resolves.toMatchObject({ id: validation.id });
    });

    it('makes a subtask a top-level card with a new number', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      const moved = await subtasks.moveToParent(ana.id, form.id, null);

      expect(moved).toMatchObject({
        parentId: null,
        numberPath: '3',
        depth: 0,
      });
    });

    it('turns a top-level card into a subtask', async () => {
      const { ana, one, two } = await setUp();

      const moved = await subtasks.moveToParent(ana.id, two.id, one.id);

      expect(moved).toMatchObject({ parentId: one.id, numberPath: '1.1' });
      await expect(
        cards.findCardByNumber(ana.id, 'WEB-2'),
      ).resolves.toMatchObject({ id: two.id });
    });

    it('refuses to move a card under itself or one of its own subtasks', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      await expect(
        subtasks.moveToParent(ana.id, one.id, form.id),
      ).rejects.toThrow(ConflictException);
      await expect(
        subtasks.moveToParent(ana.id, one.id, one.id),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a move that would go deeper than 5 levels', async () => {
      const { ana, one, two, toDo } = await setUp();
      let level = one;
      for (let depth = 1; depth <= 3; depth++) {
        level = await subtasks.createSubtask(ana.id, level.id, toDo.id, {
          title: `Level ${depth}`,
        });
      }
      await subtasks.createSubtask(ana.id, two.id, toDo.id, { title: 'Child' });

      // WEB-2 has one level below it, so under a depth-3 card it would reach 5.
      await expect(
        subtasks.moveToParent(ana.id, two.id, level.id),
      ).rejects.toThrow(ConflictException);
      await expect(numberOf(two.id)).resolves.toBe('2');
    });

    it('refuses a parent in another project', async () => {
      const { ana, one } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');
      const mobileBoard = await boards.createBoard(ana.id, mobile.id, {
        name: 'Sprint 1',
      });
      const mobileColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: mobileBoard.id },
      });
      const mobileCard = await cards.createCard(ana.id, mobileColumn.id, {
        title: 'App',
      });

      await expect(
        subtasks.moveToParent(ana.id, one.id, mobileCard.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one, two } = await setUp();

      await expect(
        subtasks.moveToParent(ben.id, two.id, one.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSubtasks and subtaskProgress', () => {
    it('lists direct subtasks in number order', async () => {
      const { ana, one, toDo } = await setUp();
      for (let i = 1; i <= 10; i++) {
        await subtasks.createSubtask(ana.id, one.id, toDo.id, {
          title: `Step ${i}`,
        });
      }

      const list = await subtasks.listSubtasks(ana.id, one.id);

      expect(list.map((card) => card.numberPath)).toEqual([
        '1.1',
        '1.2',
        '1.3',
        '1.4',
        '1.5',
        '1.6',
        '1.7',
        '1.8',
        '1.9',
        '1.10',
      ]);
    });

    it('counts complete direct subtasks only', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Errors',
      });
      const deeper = await subtasks.createSubtask(ana.id, form.id, toDo.id, {
        title: 'Validation',
      });
      await cards.completeCard(ana.id, deeper.id);
      await cards.completeCard(ana.id, form.id);

      await expect(subtasks.subtaskProgress(ana.id, one.id)).resolves.toEqual({
        complete: 1,
        total: 2,
      });
    });

    it('shows nothing to someone who is not a member', async () => {
      const { ana, ben, one, toDo } = await setUp();
      await subtasks.createSubtask(ana.id, one.id, toDo.id, { title: 'Form' });

      await expect(subtasks.listSubtasks(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(subtasks.subtaskProgress(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
