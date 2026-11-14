import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { fileScenario } from './support/files-scenario.js';
import { closeAllSockets, startLiveApp } from './support/live.js';
import { emptyBucket } from './support/storage.js';

// Regression tests from the antagonist, round 2: the card locks taken by a
// card delete. When two card changes collide in the database the API retries
// quietly (up to 3 times), so both requests succeed (approved 2026-11-14).
describe('Files on cards, attacks round 2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    delete process.env['FILE_SIZE_LIMIT_MB'];
    ({ app, prisma } = await startLiveApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await emptyBucket();
  });

  afterEach(() => {
    closeAllSockets();
  });

  afterAll(async () => {
    await app.close();
  });

  async function waitersOnLocks(n: number): Promise<void> {
    const end = Date.now() + 5000;
    for (;;) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (Number(rows[0]!.n) >= n) return;
      if (Date.now() > end) throw new Error(`Gave up waiting for ${n} waiters`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async function holdingCards(
    cardIds: string[],
    during: () => Promise<void>,
  ): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        for (const id of cardIds) {
          await tx.$queryRaw`SELECT id FROM cards WHERE id = ${id}::uuid FOR UPDATE`;
        }
        await during();
      },
      { timeout: 20_000 },
    );
  }

  async function deadlocks(): Promise<number> {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`;
    return Number(rows[0]!.n);
  }

  it('deletes a subtask while its parent is being moved under another card, without a deadlock or a 500', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const other = await newCard('New parent');
    // A subtask whose id sorts before its parent's, so the delete locks the
    // subtask first and then the parent.
    let sub: { id: string } | undefined;
    for (let i = 0; i < 20 && !sub; i++) {
      const s = await newSubtask(card.id, `Sub ${i}`);
      if (s.id < card.id) sub = s;
    }
    expect(sub, 'no subtask id sorted before the parent').toBeDefined();
    const before = await deadlocks();

    let moveParent!: Promise<{ status: number; body: unknown }>;
    let deleteSub!: Promise<{ status: number; body: unknown }>;
    await holdingCards([card.id], async () => {
      // The move of the parent queues first, then the subtask delete.
      moveParent = ana.agent
        .put(`/api/cards/${card.id}/parent`)
        .send({ parentId: other.id })
        .then((r) => r);
      await waitersOnLocks(1);
      deleteSub = ana.agent.delete(`/api/cards/${sub!.id}`).then((r) => r);
      await waitersOnLocks(2);
    });

    const moved = await moveParent;
    const deleted = await deleteSub;
    // Give the statistics a moment to be written.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(
      [moved.status, deleted.status],
      JSON.stringify([moved.body, deleted.body]),
    ).toEqual([200, 204]);
    expect(await deadlocks(), 'deadlocks detected').toBe(before);
  }, 20_000);

  it('deletes a card whose subtask becomes a card of its own while someone moves that subtask, without a deadlock or a 500', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const other = await newCard('Other parent');
    const sub = await newSubtask(card.id, 'Sub');
    const before = await deadlocks();

    let moveSub!: Promise<{ status: number; body: unknown }>;
    let deleteCard!: Promise<{ status: number; body: unknown }>;
    // Holding Ana's user row pauses the move at its first history line,
    // after it has changed the subtask.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${ana.user.id}::uuid FOR UPDATE`;
        moveSub = ana.agent
          .put(`/api/cards/${sub.id}/parent`)
          .send({ parentId: other.id })
          .then((r) => r);
        await waitersOnLocks(1);
        deleteCard = ana.agent
          .delete(`/api/cards/${card.id}`)
          .send({ subtasks: { [sub.id]: { action: 'standalone' } } })
          .then((r) => r);
        await waitersOnLocks(2);
      },
      { timeout: 20_000 },
    );

    const moved = await moveSub;
    const deleted = await deleteCard;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(
      [moved.status, deleted.status],
      JSON.stringify([moved.body, deleted.body]),
    ).toEqual([200, 204]);
  }, 20_000);

  it('stops a timer while its card is deleted, without a 500', async () => {
    const { ana, card } = await fileScenario(app);
    await ana.agent.post(`/api/cards/${card.id}/timer`).send({}).expect(201);
    // Long enough that stopping saves a time entry.
    await prisma.runningTimer.updateMany({
      data: { startedAt: new Date(Date.now() - 10 * 60_000) },
    });

    let stop!: Promise<{ status: number; body: unknown }>;
    let del!: Promise<{ status: number; body: unknown }>;
    await holdingCards([card.id], async () => {
      stop = ana.agent.delete('/api/timer').then((r) => r);
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
    });

    const stopped = await stop;
    const deleted = await del;
    expect(
      [stopped.status, deleted.status],
      JSON.stringify([stopped.body, deleted.body]),
    ).not.toContain(500);
  }, 20_000);
});
