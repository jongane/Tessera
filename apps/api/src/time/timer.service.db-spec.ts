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
import { TimerService } from './timer.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// docs/card-features.md, section 6: the start/stop timer.
describe('TimerService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let timers: TimerService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, TimerService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    timers = moduleRef.get(TimerService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setUp = () => cardScenario(prisma, boards, cards);

  // Makes the person's timer look as if it started at `startedAt`.
  function startedAt(userId: string, moment: Date) {
    return prisma.runningTimer.update({
      where: { userId },
      data: { startedAt: moment },
    });
  }

  function minutesAgo(minutes: number) {
    return new Date(Date.now() - minutes * 60 * 1000);
  }

  describe('startTimer', () => {
    it('starts a timer dated today in the person’s time zone', async () => {
      const { ana, one } = await setUp();

      const { timer, savedEntry } = await timers.startTimer(ana.id, one.id, {
        timeZone: 'Australia/Sydney',
      });

      const sydneyToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney',
      }).format(new Date());
      expect(timer).toMatchObject({
        userId: ana.id,
        cardId: one.id,
        workDate: new Date(`${sydneyToday}T00:00:00Z`),
      });
      expect(savedEntry).toBeNull();
    });

    it('keeps the running timer when started again on the same card', async () => {
      const { ana, one } = await setUp();
      const first = await timers.startTimer(ana.id, one.id);

      const again = await timers.startTimer(ana.id, one.id);

      expect(again.timer.startedAt).toEqual(first.timer.startedAt);
      expect(again.savedEntry).toBeNull();
    });

    it('warns that a timer is already running on another card', async () => {
      const { ana, one, two } = await setUp();
      await timers.startTimer(ana.id, one.id);

      const refusal = timers.startTimer(ana.id, two.id);

      await expect(refusal).rejects.toThrow(ConflictException);
      await expect(refusal).rejects.toMatchObject({
        response: { runningCardId: one.id },
      });
      await expect(timers.runningTimer(ana.id)).resolves.toMatchObject({
        cardId: one.id,
      });
    });

    it('stops and saves the old timer when the person goes ahead', async () => {
      const { ana, one, two } = await setUp();
      await timers.startTimer(ana.id, one.id);
      await startedAt(ana.id, minutesAgo(40));

      const { timer, savedEntry } = await timers.startTimer(ana.id, two.id, {
        stopRunning: true,
      });

      expect(timer.cardId).toBe(two.id);
      expect(savedEntry).toMatchObject({ cardId: one.id, minutes: 40 });
    });

    it('refuses an unknown time zone', async () => {
      const { ana, one } = await setUp();

      await expect(
        timers.startTimer(ana.id, one.id, { timeZone: 'Mars/Olympus' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(timers.startTimer(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('stopTimer', () => {
    it('saves the time as an ordinary entry with its start and end', async () => {
      const { ana, one } = await setUp();
      const { timer } = await timers.startTimer(ana.id, one.id);
      const start = minutesAgo(25);
      await startedAt(ana.id, start);

      const entry = await timers.stopTimer(ana.id);

      expect(entry).toMatchObject({
        cardId: one.id,
        userId: ana.id,
        minutes: 25,
        workDate: timer.workDate,
        startedAt: start,
      });
      expect(entry!.endedAt!.getTime()).toBeGreaterThan(start.getTime());
      await expect(timers.runningTimer(ana.id)).resolves.toBeNull();
    });

    it('dates the entry on the day the timer started, past midnight', async () => {
      const { ana, one } = await setUp();
      await timers.startTimer(ana.id, one.id);
      await prisma.runningTimer.update({
        where: { userId: ana.id },
        data: { workDate: new Date('2026-10-20'), startedAt: minutesAgo(90) },
      });

      const entry = await timers.stopTimer(ana.id);

      expect(entry!.workDate).toEqual(new Date('2026-10-20T00:00:00Z'));
    });

    it('saves at most 24 hours, flagged for review', async () => {
      const { ana, one } = await setUp();
      await timers.startTimer(ana.id, one.id);
      await startedAt(ana.id, minutesAgo(30 * 60));

      const entry = await timers.stopTimer(ana.id);

      expect(entry).toMatchObject({ minutes: 1440, needsReview: true });
    });

    it('does not flag a timer that ran for 24 hours or less', async () => {
      const { ana, one } = await setUp();
      await timers.startTimer(ana.id, one.id);
      await startedAt(ana.id, minutesAgo(24 * 60));

      const entry = await timers.stopTimer(ana.id);

      expect(entry).toMatchObject({ minutes: 1440, needsReview: false });
    });

    it('saves nothing for a timer stopped within half a minute', async () => {
      const { ana, one } = await setUp();
      await timers.startTimer(ana.id, one.id);

      await expect(timers.stopTimer(ana.id)).resolves.toBeNull();
      await expect(prisma.timeEntry.count()).resolves.toBe(0);
      await expect(timers.runningTimer(ana.id)).resolves.toBeNull();
    });

    it('says when no timer is running', async () => {
      const { ana } = await setUp();

      await expect(timers.stopTimer(ana.id)).rejects.toThrow(NotFoundException);
    });
  });
});
