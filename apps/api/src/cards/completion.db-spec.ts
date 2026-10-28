import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// docs/card-features.md, section 5.
describe('Completing cards (database)', () => {
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

  const setUp = () => cardScenario(prisma, boards, cards);

  describe('completeCard', () => {
    it("ticks the card and offers the board's done column", async () => {
      const { ana, one, done } = await setUp();

      const result = await cards.completeCard(ana.id, one.id);

      expect(result.card.isComplete).toBe(true);
      expect(result.card.completedAt).toBeInstanceOf(Date);
      expect(result.card.columnId).not.toBe(done.id);
      expect(result.doneColumnId).toBe(done.id);
    });

    it('offers no column when the card is already in a done column', async () => {
      const { ana, one, done } = await setUp();
      await cards.moveCard(ana.id, one.id, done.id);

      const result = await cards.completeCard(ana.id, one.id);

      expect(result.doneColumnId).toBeNull();
    });

    it('asks for confirmation while direct subtasks are open', async () => {
      const { ana, one, toDo } = await setUp();
      await subtasks.createSubtask(ana.id, one.id, toDo.id, { title: 'Form' });
      await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Errors',
      });

      const refusal = cards.completeCard(ana.id, one.id);

      await expect(refusal).rejects.toThrow(ConflictException);
      await expect(refusal).rejects.toMatchObject({
        response: { openSubtasks: 2 },
      });
      const confirmed = await cards.completeCard(ana.id, one.id, {
        confirmOpenSubtasks: true,
      });
      expect(confirmed.card.isComplete).toBe(true);
    });

    it('does not ask again about a card that is already complete', async () => {
      const { ana, one, toDo } = await setUp();
      await cards.completeCard(ana.id, one.id);
      await subtasks.createSubtask(ana.id, one.id, toDo.id, { title: 'Form' });

      const result = await cards.completeCard(ana.id, one.id);

      expect(result.card.isComplete).toBe(true);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(cards.completeCard(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reopenCard', () => {
    it('clears the tick and the completion time', async () => {
      const { ana, one } = await setUp();
      await cards.completeCard(ana.id, one.id);

      const reopened = await cards.reopenCard(ana.id, one.id);

      expect(reopened).toMatchObject({ isComplete: false, completedAt: null });
    });
  });

  describe('moving between columns', () => {
    it('completes a card moved into a done column', async () => {
      const { ana, one, done } = await setUp();

      const moved = await cards.moveCard(ana.id, one.id, done.id);

      expect(moved.isComplete).toBe(true);
    });

    it('reopens a card moved out of a done column', async () => {
      const { ana, one, done, inProgress } = await setUp();
      await cards.moveCard(ana.id, one.id, done.id);

      const moved = await cards.moveCard(ana.id, one.id, inProgress.id);

      expect(moved).toMatchObject({ isComplete: false, completedAt: null });
    });

    it('keeps a ticked card complete when it moves between columns that are not done', async () => {
      const { ana, one, inProgress } = await setUp();
      await cards.completeCard(ana.id, one.id);

      const moved = await cards.moveCard(ana.id, one.id, inProgress.id);

      expect(moved.isComplete).toBe(true);
    });

    it('asks for confirmation before moving a parent with open subtasks into a done column', async () => {
      const { ana, one, toDo, done } = await setUp();
      await subtasks.createSubtask(ana.id, one.id, toDo.id, { title: 'Form' });

      await expect(cards.moveCard(ana.id, one.id, done.id)).rejects.toThrow(
        ConflictException,
      );
      const moved = await cards.moveCard(ana.id, one.id, done.id, {
        confirmOpenSubtasks: true,
      });
      expect(moved).toMatchObject({ columnId: done.id, isComplete: true });
    });
  });
});
