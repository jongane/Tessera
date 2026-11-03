import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { TimeEntriesService } from './time-entries.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createUser } from '../../test/support/factories.js';

// docs/card-features.md, section 6: typed-in time and who may change it.
describe('TimeEntriesService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let entries: TimeEntriesService;
  let projects: ProjectsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        CardsService,
        TimeEntriesService,
        ProjectsService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    entries = moduleRef.get(TimeEntriesService);
    projects = moduleRef.get(ProjectsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Ana is the admin, Cara an ordinary member, Ben not a member.
  async function setUp() {
    const scenario = await cardScenario(prisma, boards, cards);
    const cara = await createUser(prisma, 'cara');
    await prisma.projectMember.create({
      data: { projectId: scenario.project.id, userId: cara.id },
    });
    return { ...scenario, cara };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // Pacific/Kiritimati (UTC+14) is always 25 hours ahead of
  // Pacific/Pago_Pago (UTC-11), so its today has never started yet in
  // Pago Pago, whenever the test runs.
  const AHEAD = 'Pacific/Kiritimati';
  const BEHIND = 'Pacific/Pago_Pago';

  function todayIn(timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  }

  function futureDayMessage(timeZone: string) {
    return `Time can't be logged for a day that hasn't started yet in the project's time zone (${timeZone})`;
  }

  // Makes an entry look as if it was logged `hours` ago.
  function ageEntry(entryId: string, hours: number) {
    return prisma.timeEntry.update({
      where: { id: entryId },
      data: { createdAt: new Date(Date.now() - hours * 3600 * 1000) },
    });
  }

  describe('logTime', () => {
    it("logs time for the person on the card's project", async () => {
      const { cara, project, one } = await setUp();

      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 90,
        workDate: '2026-10-27',
        note: 'Wired up the form',
      });

      expect(entry).toMatchObject({
        projectId: project.id,
        cardId: one.id,
        userId: cara.id,
        minutes: 90,
        workDate: new Date('2026-10-27T00:00:00Z'),
        note: 'Wired up the form',
        startedAt: null,
      });
    });

    it('refuses more than 24 hours, no time, or a future day', async () => {
      const { cara, one } = await setUp();

      await expect(
        entries.logTime(cara.id, one.id, { minutes: 1441, workDate: today() }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        entries.logTime(cara.id, one.id, { minutes: 0, workDate: today() }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        entries.logTime(cara.id, one.id, {
          minutes: 30,
          workDate: '2999-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(prisma.timeEntry.count()).resolves.toBe(0);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(
        entries.logTime(ben.id, one.id, { minutes: 30, workDate: today() }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listEntries', () => {
    it("shows every member everyone's time, latest day first", async () => {
      const { ana, cara, one } = await setUp();
      await entries.logTime(ana.id, one.id, {
        minutes: 30,
        workDate: '2026-10-25',
      });
      await entries.logTime(cara.id, one.id, {
        minutes: 45,
        workDate: '2026-10-27',
      });

      const list = await entries.listEntries(cara.id, one.id);

      expect(list.map((e) => [e.user.displayName, e.minutes])).toEqual([
        ['cara', 45],
        ['ana', 30],
      ]);
    });

    it('shows nothing to someone who is not a member', async () => {
      const { ben, one } = await setUp();

      await expect(entries.listEntries(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateEntry and deleteEntry', () => {
    async function setUpWithEntry() {
      const setup = await setUp();
      const entry = await entries.logTime(setup.cara.id, setup.one.id, {
        minutes: 30,
        workDate: '2026-10-27',
      });
      return { ...setup, entry };
    }

    it('lets a person change their own entry within 24 hours', async () => {
      const { cara, entry } = await setUpWithEntry();
      await ageEntry(entry.id, 23);

      const updated = await entries.updateEntry(cara.id, entry.id, {
        minutes: 50,
        workDate: '2026-10-26',
        note: 'Fixed',
      });

      expect(updated).toMatchObject({
        minutes: 50,
        workDate: new Date('2026-10-26T00:00:00Z'),
        note: 'Fixed',
      });
    });

    it('lets a person delete their own entry within 24 hours', async () => {
      const { cara, entry } = await setUpWithEntry();

      await entries.deleteEntry(cara.id, entry.id);

      await expect(prisma.timeEntry.count()).resolves.toBe(0);
    });

    it('refuses a person their own entry after 24 hours', async () => {
      const { cara, entry } = await setUpWithEntry();
      await ageEntry(entry.id, 25);

      await expect(
        entries.updateEntry(cara.id, entry.id, { minutes: 50 }),
      ).rejects.toThrow(ForbiddenException);
      await expect(entries.deleteEntry(cara.id, entry.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("refuses a member someone else's entry", async () => {
      const { ana, cara, one } = await setUp();
      const anas = await entries.logTime(ana.id, one.id, {
        minutes: 30,
        workDate: '2026-10-27',
      });

      await expect(
        entries.updateEntry(cara.id, anas.id, { minutes: 50 }),
      ).rejects.toThrow(ForbiddenException);
      await expect(entries.deleteEntry(cara.id, anas.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("lets an admin change or delete anyone's entry at any time", async () => {
      const { ana, entry } = await setUpWithEntry();
      await ageEntry(entry.id, 24 * 30);

      await expect(
        entries.updateEntry(ana.id, entry.id, { minutes: 50 }),
      ).resolves.toMatchObject({ minutes: 50 });
      await entries.deleteEntry(ana.id, entry.id);
      await expect(prisma.timeEntry.count()).resolves.toBe(0);
    });

    it('clears the review flag when the entry is edited or confirmed as it is', async () => {
      const { ana, cara, entry } = await setUpWithEntry();
      const flag = () =>
        prisma.timeEntry.update({
          where: { id: entry.id },
          data: { needsReview: true },
        });

      await flag();
      await expect(
        entries.updateEntry(cara.id, entry.id, { minutes: 600 }),
      ).resolves.toMatchObject({ needsReview: false });
      await flag();
      await expect(
        entries.updateEntry(ana.id, entry.id, {}),
      ).resolves.toMatchObject({ minutes: 600, needsReview: false });
    });

    it('checks the new values like a new entry', async () => {
      const { cara, entry } = await setUpWithEntry();

      await expect(
        entries.updateEntry(cara.id, entry.id, { minutes: 2000 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        entries.updateEntry(cara.id, entry.id, { workDate: '2999-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('treats an entry in another project as not found', async () => {
      const { ben, entry } = await setUpWithEntry();

      await expect(
        entries.updateEntry(ben.id, entry.id, { minutes: 50 }),
      ).rejects.toThrow(NotFoundException);
      await expect(entries.deleteEntry(ben.id, entry.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
  // Criteria 2, 3, 7 and 9: dates are checked in the project's time zone.
  describe("in the project's time zone", () => {
    async function setUpIn(timeZone: string) {
      const setup = await setUp();
      await projects.setTimeZone(setup.ana.id, setup.project.id, timeZone);
      return setup;
    }

    // Criterion 2
    it("logs today in the card's project time zone", async () => {
      const { cara, one } = await setUpIn(AHEAD);

      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 30,
        workDate: todayIn(AHEAD),
      });

      expect(entry.workDate).toEqual(new Date(`${todayIn(AHEAD)}T00:00:00Z`));
    });

    // Criteria 2 and 9
    it('refuses a day that has started elsewhere but not in the project time zone', async () => {
      const { cara, one } = await setUpIn(BEHIND);

      await expect(
        entries.logTime(cara.id, one.id, {
          minutes: 30,
          workDate: todayIn(AHEAD),
        }),
      ).rejects.toThrow(futureDayMessage(BEHIND));
      await expect(prisma.timeEntry.count()).resolves.toBe(0);
      await expect(
        entries.logTime(cara.id, one.id, {
          minutes: 30,
          workDate: todayIn(BEHIND),
        }),
      ).resolves.toMatchObject({
        workDate: new Date(`${todayIn(BEHIND)}T00:00:00Z`),
      });
    });

    // Criterion 3
    it("checks a changed date against the project's time zone, for the person and an admin", async () => {
      const { ana, cara, one } = await setUpIn(BEHIND);
      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 30,
        workDate: '2026-10-27',
      });

      for (const who of [cara, ana]) {
        await expect(
          entries.updateEntry(who.id, entry.id, { workDate: todayIn(AHEAD) }),
        ).rejects.toThrow(futureDayMessage(BEHIND));
      }
      await expect(
        prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } }),
      ).resolves.toMatchObject({ workDate: new Date('2026-10-27T00:00:00Z') });
      await expect(
        entries.updateEntry(ana.id, entry.id, { workDate: todayIn(BEHIND) }),
      ).resolves.toMatchObject({
        workDate: new Date(`${todayIn(BEHIND)}T00:00:00Z`),
      });
    });

    // Criterion 3: sending back the entry's own date unchanged is not a
    // change, so it is not checked against the future-day rule.
    it("does not check the date when an edit sends back the entry's current date", async () => {
      const { ana, cara, one } = await setUpIn(BEHIND);
      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 30,
        workDate: todayIn(BEHIND),
      });
      // As if logged under the old rule: a day that has started in
      // Kiritimati but not yet in the project's zone.
      const oldRuleDay = todayIn(AHEAD);
      // A day that has not started anywhere yet.
      const farDay = '2999-01-01';

      for (const [who, day] of [
        [cara, oldRuleDay],
        [ana, oldRuleDay],
        [cara, farDay],
      ] as const) {
        await prisma.timeEntry.update({
          where: { id: entry.id },
          data: { workDate: new Date(`${day}T00:00:00Z`) },
        });

        await expect(
          entries.updateEntry(who.id, entry.id, {
            workDate: day,
            note: `Kept ${day}`,
          }),
        ).resolves.toMatchObject({
          note: `Kept ${day}`,
          workDate: new Date(`${day}T00:00:00Z`),
        });
      }
    });

    // Criterion 3: an old entry dated later than today in the project's
    // zone can still be changed, as long as the date is left out.
    it('does not check the date again when an edit leaves it out', async () => {
      const { cara, one } = await setUpIn(BEHIND);
      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 30,
        workDate: todayIn(BEHIND),
      });
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: { workDate: new Date(`${todayIn(AHEAD)}T00:00:00Z`) },
      });

      await expect(
        entries.updateEntry(cara.id, entry.id, { minutes: 50 }),
      ).resolves.toMatchObject({
        minutes: 50,
        workDate: new Date(`${todayIn(AHEAD)}T00:00:00Z`),
      });
    });

    // Criterion 7
    it("keeps an entry's date when the project's time zone changes", async () => {
      const { ana, cara, project, one } = await setUpIn(AHEAD);
      const entry = await entries.logTime(cara.id, one.id, {
        minutes: 30,
        workDate: todayIn(AHEAD),
      });

      await projects.setTimeZone(ana.id, project.id, BEHIND);

      await expect(
        prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } }),
      ).resolves.toMatchObject({
        workDate: new Date(`${todayIn(AHEAD)}T00:00:00Z`),
      });
    });
  });
});
