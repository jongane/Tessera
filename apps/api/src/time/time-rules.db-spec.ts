import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// Estimates, time entries and running timers (docs/card-features.md,
// section 6). Like subtask-rules.db-spec.ts, these write to the database
// directly to prove it refuses bad data. Each refusal names its constraint.
describe('Time rules (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    return { ana, project, board, column, card };
  }

  function entry(
    ids: { projectId: string; cardId: string; userId: string },
    fields: Partial<{
      minutes: number;
      startedAt: Date | null;
      endedAt: Date | null;
    }> = {},
  ) {
    return prisma.timeEntry.create({
      data: {
        ...ids,
        workDate: new Date('2026-10-27'),
        minutes: 30,
        ...fields,
      },
    });
  }

  it('refuses a negative estimate', async () => {
    const { card } = await setUp();

    await expect(
      prisma.card.update({
        where: { id: card.id },
        data: { estimateMinutes: -1 },
      }),
    ).rejects.toThrow('cards_estimate_not_negative');
  });

  it('keeps each time entry between 1 minute and 24 hours', async () => {
    const { ana, project, card } = await setUp();
    const ids = { projectId: project.id, cardId: card.id, userId: ana.id };

    await expect(entry(ids, { minutes: 1440 })).resolves.toBeDefined();
    await expect(entry(ids, { minutes: 0 })).rejects.toThrow(
      'time_entries_minutes_range',
    );
    await expect(entry(ids, { minutes: 1441 })).rejects.toThrow(
      'time_entries_minutes_range',
    );
  });

  it('does not flag a new entry for review', async () => {
    const { ana, project, card } = await setUp();

    await expect(
      entry({ projectId: project.id, cardId: card.id, userId: ana.id }),
    ).resolves.toMatchObject({ needsReview: false });
  });

  it('gives a timer entry both a start and a later end, or neither', async () => {
    const { ana, project, card } = await setUp();
    const ids = { projectId: project.id, cardId: card.id, userId: ana.id };
    const start = new Date('2026-10-27T09:00:00Z');
    const end = new Date('2026-10-27T09:30:00Z');

    await expect(
      entry(ids, { startedAt: start, endedAt: end }),
    ).resolves.toBeDefined();
    await expect(entry(ids, { startedAt: start })).rejects.toThrow(
      'time_entries_timer_times',
    );
    await expect(
      entry(ids, { startedAt: end, endedAt: start }),
    ).rejects.toThrow('time_entries_timer_times');
  });

  it('keeps a time entry in its card’s project', async () => {
    const { ana, card } = await setUp();
    const other = await createProject(prisma, ana.id, 'Mobile', 'MOB');

    await expect(
      entry({ projectId: other.id, cardId: card.id, userId: ana.id }),
    ).rejects.toThrow('time_entries_card_id_project_id_fkey');
  });

  it('refuses to delete a card that has logged time', async () => {
    const { ana, project, card } = await setUp();
    await entry({ projectId: project.id, cardId: card.id, userId: ana.id });

    await expect(
      prisma.card.delete({ where: { id: card.id } }),
    ).rejects.toThrow('time_entries_card_id_project_id_fkey');
  });

  it('still deletes a whole project with its cards and time', async () => {
    const { ana, project, card } = await setUp();
    await entry({ projectId: project.id, cardId: card.id, userId: ana.id });
    await prisma.runningTimer.create({
      data: {
        userId: ana.id,
        projectId: project.id,
        cardId: card.id,
        workDate: new Date('2026-10-27'),
      },
    });

    await prisma.project.delete({ where: { id: project.id } });

    await expect(prisma.timeEntry.count()).resolves.toBe(0);
    await expect(prisma.runningTimer.count()).resolves.toBe(0);
  });

  it('allows one running timer per person', async () => {
    const { ana, project, card } = await setUp();
    const timer = {
      userId: ana.id,
      projectId: project.id,
      cardId: card.id,
      workDate: new Date('2026-10-27'),
    };
    await prisma.runningTimer.create({ data: timer });

    await expect(prisma.runningTimer.create({ data: timer })).rejects.toThrow(
      'Unique constraint',
    );
  });

  it('drops a running timer when its card is deleted', async () => {
    const { ana, project, card } = await setUp();
    await prisma.runningTimer.create({
      data: {
        userId: ana.id,
        projectId: project.id,
        cardId: card.id,
        workDate: new Date('2026-10-27'),
      },
    });

    await prisma.card.delete({ where: { id: card.id } });

    await expect(prisma.runningTimer.count()).resolves.toBe(0);
  });
});
