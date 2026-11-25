import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { fileScenario } from './support/files-scenario.js';
import { closeAllSockets, startLiveApp } from './support/live.js';
import { emptyBucket } from './support/storage.js';

// Same-moment changes: what the round-4 fixes left open (kept from the
// antagonist's round 5).
describe('Card changes at the same moment, attacks round 5 (e2e)', () => {
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

  // Gives the card `parentId` `n` direct subtasks, straight in the database
  // (through the API this would take minutes), and answers their ids.
  async function manySubtasks(
    parentId: string,
    columnId: string,
    n: number,
  ): Promise<string[]> {
    const parent = await prisma.card.findUniqueOrThrow({
      where: { id: parentId },
    });
    await prisma.card.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        projectId: parent.projectId,
        boardId: parent.boardId,
        columnId,
        parentId: parent.id,
        depth: 1,
        numberPath: `${parent.numberPath}.${i + 1}`,
        title: `Step ${i + 1}`,
        position: i + 1,
        createdById: parent.createdById,
      })),
    });
    await prisma.card.update({
      where: { id: parent.id },
      data: { nextSubtaskNumber: n + 1 },
    });
    const rows = await prisma.card.findMany({
      where: { parentId: parent.id },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // A delete of a large card tree may now hold its locks for up to 30 s
  // (LARGE_CHANGE_TIMEOUT_MS), but every other card change still has
  // Prisma's 5 s limit. One that waits behind the delete for longer than 5 s
  // fails with Prisma's "transaction expired" error, which nothing turns into
  // a 4xx: the person gets 500.
  it('answers an edit of a subtask that waited behind a long delete of its parent without 500', async () => {
    const { ana, newCard, toDo } = await fileScenario(app);

    // One try: a parent with `n` subtasks is deleted, and a moment later the
    // last subtask is edited. Answers what the two got and how long the edit
    // itself waited.
    async function tryWith(n: number) {
      const parent = await newCard(`Parent of ${n}`);
      const ids = await manySubtasks(parent.id, toDo.id, n);
      const choices = Object.fromEntries(
        ids.map((id) => [id, { action: 'standalone' }]),
      );
      const deletion = ana.agent
        .delete(`/api/cards/${parent.id}`)
        .send({ subtasks: choices })
        .then((r) => r);
      // Once the delete holds the subtasks, someone edits the last one.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const sent = Date.now();
      const edit = ana.agent
        .patch(`/api/cards/${ids[ids.length - 1]!}`)
        .send({ title: 'Renamed' })
        .then((r) => ({ response: r, waited: Date.now() - sent }));
      const [deleted, edited] = await Promise.all([deletion, edit]);
      return { deleted, edited: edited.response, waited: edited.waited, n };
    }

    // The scenario needs the edit to wait longer than Prisma's 5 s limit. How
    // big a tree that takes depends on the machine, so the tree grows until
    // the edit has been measured to wait that long (never 500 is checked on
    // every try, too).
    const LIMIT_MS = 5000;
    const MARGIN_MS = 500;
    let result = await tryWith(1500);
    for (const n of [3000, 6000, 12000]) {
      expectNever500(result.edited);
      if (result.waited > LIMIT_MS + MARGIN_MS) break;
      result = await tryWith(n);
    }

    expect(result.deleted.status, JSON.stringify(result.deleted.body)).toBe(
      204,
    );
    expect(
      result.waited,
      `the edit waited only ${result.waited} ms behind a delete of ${result.n} subtasks`,
    ).toBeGreaterThan(LIMIT_MS);
    expectNever500(result.edited);
  }, 280_000);

  // Never 500: after the delete the edit works (200), or collides (409), or
  // its card went with the delete (404).
  function expectNever500(edited: { status: number; body: unknown }) {
    expect(edited.status, JSON.stringify(edited.body)).not.toBe(500);
    expect([200, 404, 409]).toContain(edited.status);
    const message = (edited.body as { message: string }).message;
    if (edited.status === 409) {
      expect(message).toBe(
        'Someone changed this card at the same time. Try again.',
      );
    }
    if (edited.status === 404) {
      expect(message).toBe('Card not found');
    }
  }

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

  // Round 4's fix reads the label again after locking the card, but
  // DELETE /labels/:labelId takes no card lock, so a delete that is under way
  // (row gone, not yet committed) still passes the check; the insert then
  // waits on the label row and fails on the foreign key once the delete
  // commits.
  it('answers 404, not 500, when a label is being deleted at the moment it is put on a card', async () => {
    const { ana, card, project } = await fileScenario(app);
    const label = (
      await ana.agent
        .post(`/api/projects/${project.id}/labels`)
        .send({ name: 'Bug', colour: 'RED' })
        .expect(201)
    ).body as { id: string };

    let put!: Promise<{ status: number; body: unknown }>;
    await prisma.$transaction(
      async (tx) => {
        // An admin's delete of the label, not yet committed.
        await tx.label.delete({ where: { id: label.id } });
        put = ana.agent
          .put(`/api/cards/${card.id}/labels/${label.id}`)
          .then((r) => r);
        await waitersOnLocks(1);
      },
      { timeout: 20_000 },
    );
    const answer = await put;
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect((answer.body as { message: string }).message).toBe(
      'Label not found',
    );
    expect(await prisma.cardLabel.count()).toBe(0);
  }, 20_000);
});
