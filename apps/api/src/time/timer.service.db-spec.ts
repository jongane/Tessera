import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { TimerService } from './timer.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createProject } from '../../test/support/factories.js';

// docs/card-features.md, section 6: the start/stop timer.
describe('TimerService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let timers: TimerService;
  let projects: ProjectsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, TimerService, ProjectsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    timers = moduleRef.get(TimerService);
    projects = moduleRef.get(ProjectsService);
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

  // Pacific/Kiritimati (UTC+14) is always 25 hours ahead of
  // Pacific/Pago_Pago (UTC-11), so the two are never on the same day.
  const AHEAD = 'Pacific/Kiritimati';
  const BEHIND = 'Pacific/Pago_Pago';

  function todayIn(timeZone: string) {
    const text = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
      new Date(),
    );
    return new Date(`${text}T00:00:00Z`);
  }

  // A second project for Ana, with the time zone `timeZone` and one card.
  async function cardInProjectAt(adminId: string, timeZone: string) {
    const project = await createProject(prisma, adminId, 'Shop', 'SHOP');
    await projects.setTimeZone(adminId, project.id, timeZone);
    const board = await boards.createBoard(adminId, project.id, {
      name: 'Sprint 1',
    });
    const column = await prisma.column.findFirstOrThrow({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return cards.createCard(adminId, column.id, { title: 'Basket' });
  }

  describe('startTimer', () => {
    // Criterion 4
    it("starts a timer dated today in the card's project time zone", async () => {
      const { ana, project, one } = await setUp();
      await projects.setTimeZone(ana.id, project.id, AHEAD);
      const behindCard = await cardInProjectAt(ana.id, BEHIND);

      const { timer, savedEntry } = await timers.startTimer(ana.id, one.id);

      expect(timer).toMatchObject({
        userId: ana.id,
        cardId: one.id,
        workDate: todayIn(AHEAD),
      });
      expect(savedEntry).toBeNull();

      const next = await timers.startTimer(ana.id, behindCard.id, {
        stopRunning: true,
      });

      expect(next.timer).toMatchObject({
        cardId: behindCard.id,
        workDate: todayIn(BEHIND),
      });
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

    // Criterion 4: stopping after midnight keeps the start day.
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

    // Criterion 6
    it("keeps the day the timer started when the project's time zone changes", async () => {
      const { ana, project, one } = await setUp();
      await projects.setTimeZone(ana.id, project.id, BEHIND);
      const { timer } = await timers.startTimer(ana.id, one.id);
      await startedAt(ana.id, minutesAgo(5));

      await projects.setTimeZone(ana.id, project.id, AHEAD);
      const entry = await timers.stopTimer(ana.id);

      expect(timer.workDate).toEqual(todayIn(BEHIND));
      expect(entry!.workDate).toEqual(todayIn(BEHIND));
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
