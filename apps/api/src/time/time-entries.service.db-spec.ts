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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, TimeEntriesService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    entries = moduleRef.get(TimeEntriesService);
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
});
