import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { ActivityService } from './activity.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// The Activity tab (docs/card-features.md, section 9).
describe('ActivityService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let activity: ActivityService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, ActivityService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    activity = moduleRef.get(ActivityService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setUp = () => cardScenario(prisma, boards, cards);

  // The card's history, oldest first, as [kind, details] pairs.
  async function history(userId: string, cardId: string) {
    const page = await activity.listActivity(userId, cardId);
    return page.items.reverse().map((line) => [line.kind, line.details]);
  }

  describe('listActivity', () => {
    it('starts with the card being created, by whom', async () => {
      const { ana, one } = await setUp();

      const page = await activity.listActivity(ana.id, one.id);

      expect(page.items).toEqual([
        expect.objectContaining({
          kind: 'CREATED',
          details: { numberPath: '1', title: 'Login' },
          actor: { id: ana.id, displayName: expect.any(String) },
        }),
      ]);
      expect(page.nextBefore).toBeNull();
    });

    it('shows the newest first, a page at a time', async () => {
      const { ana, one } = await setUp();
      for (const title of ['A', 'B', 'C']) {
        await cards.updateCard(ana.id, one.id, { title });
      }

      const first = await activity.listActivity(ana.id, one.id, { limit: 2 });
      const second = await activity.listActivity(ana.id, one.id, {
        limit: 2,
        before: first.nextBefore!,
      });

      expect(first.items.map((l) => l.details)).toEqual([
        { from: 'B', to: 'C' },
        { from: 'A', to: 'B' },
      ]);
      expect(second.items.map((l) => l.kind)).toEqual([
        'TITLE_CHANGED',
        'CREATED',
      ]);
      expect(second.nextBefore).toBeNull();
    });

    it('refuses a bad page size or cursor', async () => {
      const { ana, one } = await setUp();

      await expect(
        activity.listActivity(ana.id, one.id, { limit: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        activity.listActivity(ana.id, one.id, { limit: 101 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        activity.listActivity(ana.id, one.id, { before: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(activity.listActivity(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('card fields', () => {
    it('records title and description changes with the old and new text', async () => {
      const { ana, one } = await setUp();

      await cards.updateCard(ana.id, one.id, {
        title: ' Sign in ',
        description: 'Email and password',
      });
      await cards.updateCard(ana.id, one.id, { description: '' });

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['TITLE_CHANGED', { from: 'Login', to: 'Sign in' }],
        ['DESCRIPTION_CHANGED', { from: null, to: 'Email and password' }],
        ['DESCRIPTION_CHANGED', { from: 'Email and password', to: null }],
      ]);
    });

    it('refuses a blank or very long title', async () => {
      const { ana, one } = await setUp();

      await expect(
        cards.updateCard(ana.id, one.id, { title: ' ' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        cards.updateCard(ana.id, one.id, { title: 'x'.repeat(201) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records priority, due date and estimate changes', async () => {
      const { ana, one } = await setUp();

      await cards.setPriority(ana.id, one.id, 'HIGH');
      await cards.setDueDate(ana.id, one.id, { date: '2026-11-02' });
      await cards.setEstimate(ana.id, one.id, 90);
      await cards.setEstimate(ana.id, one.id, null);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }],
        [
          'DUE_DATE_CHANGED',
          {
            from: { at: null, hasTime: false },
            to: { at: '2026-11-02T00:00:00.000Z', hasTime: false },
          },
        ],
        ['ESTIMATE_CHANGED', { from: null, to: 90 }],
        ['ESTIMATE_CHANGED', { from: 90, to: null }],
      ]);
    });

    it('records nothing when a value is set to what it already was', async () => {
      const { ana, one } = await setUp();

      await cards.updateCard(ana.id, one.id, { title: 'Login' });
      await cards.setPriority(ana.id, one.id, 'NONE');
      await cards.setDueDate(ana.id, one.id, null);
      await cards.setEstimate(ana.id, one.id, null);

      expect(await history(ana.id, one.id)).toHaveLength(1);
    });
  });

  describe('moves and completion', () => {
    it('records moves between columns by name, and the completion they cause', async () => {
      const { ana, one, toDo, inProgress, done } = await setUp();

      await cards.moveCard(ana.id, one.id, inProgress.id);
      await cards.moveCard(ana.id, one.id, done.id);
      await cards.moveCard(ana.id, one.id, toDo.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        [
          'MOVED',
          {
            from: { columnId: toDo.id, name: toDo.name },
            to: { columnId: inProgress.id, name: inProgress.name },
          },
        ],
        [
          'MOVED',
          expect.objectContaining({
            to: expect.objectContaining({ columnId: done.id }),
          }),
        ],
        ['COMPLETED', {}],
        [
          'MOVED',
          expect.objectContaining({
            to: expect.objectContaining({ columnId: toDo.id }),
          }),
        ],
        ['REOPENED', {}],
      ]);
    });

    it('records completing and reopening by hand, but not repeats', async () => {
      const { ana, one } = await setUp();

      await cards.completeCard(ana.id, one.id);
      await cards.completeCard(ana.id, one.id);
      await cards.reopenCard(ana.id, one.id);
      await cards.reopenCard(ana.id, one.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['COMPLETED', {}],
        ['REOPENED', {}],
      ]);
    });
  });
});
