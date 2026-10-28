import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { SubtasksService } from '../cards/subtasks.service.js';
import { CardTotalsService } from './card-totals.service.js';
import { TimeEntriesService } from './time-entries.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// docs/card-features.md, section 6: estimates, rollups, and keeping logged
// time when a card is deleted.
describe('Estimates and totals (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;
  let totals: CardTotalsService;
  let entries: TimeEntriesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        CardsService,
        SubtasksService,
        CardTotalsService,
        TimeEntriesService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
    totals = moduleRef.get(CardTotalsService);
    entries = moduleRef.get(TimeEntriesService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setUp = () => cardScenario(prisma, boards, cards);

  function log(userId: string, cardId: string, minutes: number) {
    return entries.logTime(userId, cardId, {
      minutes,
      workDate: '2026-10-27',
    });
  }

  describe('setEstimate', () => {
    it('sets and clears a card’s estimate', async () => {
      const { ana, one } = await setUp();

      await expect(
        cards.setEstimate(ana.id, one.id, 150),
      ).resolves.toMatchObject({ estimateMinutes: 150 });
      await expect(
        cards.setEstimate(ana.id, one.id, null),
      ).resolves.toMatchObject({ estimateMinutes: null });
    });

    it('refuses a negative or fractional estimate', async () => {
      const { ana, one } = await setUp();

      await expect(cards.setEstimate(ana.id, one.id, -10)).rejects.toThrow(
        BadRequestException,
      );
      await expect(cards.setEstimate(ana.id, one.id, 1.5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(cards.setEstimate(ben.id, one.id, 60)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('totals', () => {
    it('adds up estimates and time from every level below a card', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      const validation = await subtasks.createSubtask(
        ana.id,
        form.id,
        toDo.id,
        { title: 'Validation' },
      );
      const errors = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Errors',
      });
      await cards.setEstimate(ana.id, one.id, 480);
      await cards.setEstimate(ana.id, form.id, 999);
      await cards.setEstimate(ana.id, validation.id, 90);
      await cards.setEstimate(ana.id, errors.id, 60);
      await log(ana.id, one.id, 15);
      await log(ana.id, validation.id, 45);
      await log(ana.id, errors.id, 30);

      await expect(totals.totals(ana.id, one.id)).resolves.toEqual({
        estimateMinutes: 150,
        originalEstimateMinutes: 480,
        timeSpentMinutes: 90,
        ownTimeMinutes: 15,
      });
      await expect(totals.totals(ana.id, errors.id)).resolves.toEqual({
        estimateMinutes: 60,
        originalEstimateMinutes: null,
        timeSpentMinutes: 30,
        ownTimeMinutes: 30,
      });
    });

    it('shows nothing to someone who is not a member', async () => {
      const { ben, one } = await setUp();

      await expect(totals.totals(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleting a card with logged time', () => {
    it('refuses, and says how much time is logged', async () => {
      const { ana, one } = await setUp();
      await log(ana.id, one.id, 80);

      const refusal = cards.deleteCard(ana.id, one.id);

      await expect(refusal).rejects.toThrow(ConflictException);
      await expect(refusal).rejects.toMatchObject({
        response: { loggedMinutes: 80 },
      });
      await expect(prisma.card.count({ where: { id: one.id } })).resolves.toBe(
        1,
      );
    });

    it('refuses when a subtask chosen for deletion has logged time', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      await log(ana.id, form.id, 20);

      await expect(
        cards.deleteCard(ana.id, one.id, { [form.id]: { action: 'delete' } }),
      ).rejects.toMatchObject({ response: { loggedMinutes: 20 } });
    });

    it('deletes the card once its subtask with time is kept', async () => {
      const { ana, one, toDo } = await setUp();
      const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      await log(ana.id, form.id, 20);

      await cards.deleteCard(ana.id, one.id, {
        [form.id]: { action: 'standalone' },
      });

      await expect(prisma.card.count({ where: { id: one.id } })).resolves.toBe(
        0,
      );
      await expect(prisma.timeEntry.count()).resolves.toBe(1);
    });

    it('deletes the card once an admin has removed its time', async () => {
      const { ana, one } = await setUp();
      const entry = await log(ana.id, one.id, 80);
      await entries.deleteEntry(ana.id, entry.id);

      await cards.deleteCard(ana.id, one.id);

      await expect(prisma.card.count({ where: { id: one.id } })).resolves.toBe(
        0,
      );
    });
  });
});
