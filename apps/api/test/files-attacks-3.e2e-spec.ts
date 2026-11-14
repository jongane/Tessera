import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { fileScenario } from './support/files-scenario.js';
import { closeAllSockets, startLiveApp } from './support/live.js';
import { emptyBucket } from './support/storage.js';

// Antagonist, round 3: card changes that wait on a card lock and then carry
// on with what they read before they waited. Expected results (Jon, 2026-11-14,
// pending his final word): a change to a card that is deleted while it waits
// answers 404 "Card not found"; a card delete whose subtasks changed while it
// waited answers 409 and changes nothing; moves and subtask adds that collide
// both end with correct numbers and depths.
describe('Card changes at the same moment, attacks round 3 (e2e)', () => {
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

  type Answer = { status: number; body: unknown };

  const CHANGED = 'Someone changed this card at the same time. Try again.';

  function messageOf(a: Answer): unknown {
    return (a.body as { message?: unknown }).message;
  }

  function removedFrom(cardId: string) {
    return prisma.cardActivity.count({
      where: { cardId, kind: 'SUBTASK_REMOVED' },
    });
  }

  it('keeps a subtask numbered under its parent when two people move that parent at once', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub'); // 1.1
    const below = await newSubtask(sub.id, 'Below'); // 1.1.1
    // A parent with a two-digit number, so the old and new numbers differ in length.
    let target = await newCard('Target');
    while (
      (await prisma.card.findUniqueOrThrow({ where: { id: target.id } }))
        .numberPath.length < 2
    ) {
      target = await newCard('Target');
    }

    let first!: Promise<Answer>;
    let second!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      first = ana.agent
        .put(`/api/cards/${sub.id}/parent`)
        .send({ parentId: target.id })
        .then((r) => r);
      await waitersOnLocks(1);
      second = ana.agent
        .put(`/api/cards/${sub.id}/parent`)
        .send({ parentId: null })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const answers = [await first, await second];
    // Both succeed; the later move (to the top level) wins.
    expect(answers.map((a) => a.status)).toEqual([200, 200]);

    const s = await prisma.card.findUniqueOrThrow({ where: { id: sub.id } });
    const b = await prisma.card.findUniqueOrThrow({ where: { id: below.id } });
    expect(s.parentId).toBeNull();
    expect(s.depth).toBe(0);
    expect(b.parentId).toBe(s.id);
    expect(b.numberPath).toBe(`${s.numberPath}.1`);
    expect(b.depth).toBe(s.depth + 1);
    // SUBTASK_REMOVED goes on the parent each move really left.
    expect(await removedFrom(card.id)).toBe(1);
    expect(await removedFrom(target.id)).toBe(1);
  }, 20_000);

  it('numbers the subtasks of a card right when it is moved to the top level and under another card at once', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const a = await newSubtask(card.id, 'A'); // WEB-1.1
    const a1 = await newSubtask(a.id, 'A1'); // WEB-1.1.1
    const two = await newCard('Two'); // WEB-2

    let toTop!: Promise<Answer>;
    let underTwo!: Promise<Answer>;
    await holdingCards([a.id], async () => {
      toTop = ana.agent
        .put(`/api/cards/${a.id}/parent`)
        .send({ parentId: null })
        .then((r) => r);
      await waitersOnLocks(1);
      underTwo = ana.agent
        .put(`/api/cards/${a.id}/parent`)
        .send({ parentId: two.id })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const answers = [await toTop, await underTwo];
    expect(answers.map((x) => x.status)).toEqual([200, 200]);

    const aNow = await prisma.card.findUniqueOrThrow({ where: { id: a.id } });
    const twoNow = await prisma.card.findUniqueOrThrow({
      where: { id: two.id },
    });
    const a1Now = await prisma.card.findUniqueOrThrow({
      where: { id: a1.id },
    });
    expect(aNow.parentId).toBe(two.id);
    expect(aNow.depth).toBe(1);
    expect(aNow.numberPath.startsWith(`${twoNow.numberPath}.`)).toBe(true);
    expect(a1Now.parentId).toBe(a.id);
    expect(a1Now.numberPath).toBe(`${aNow.numberPath}.1`);
    expect(a1Now.depth).toBe(aNow.depth + 1);
    // A left WEB-1 with the first move and nothing was removed from WEB-2.
    expect(await removedFrom(card.id)).toBe(1);
    expect(await removedFrom(two.id)).toBe(0);
  }, 20_000);

  it('refuses a subtask deeper than 5 levels when its parent is moved deeper while it is being added', async () => {
    const { ana, card, newCard, newSubtask, toDo } = await fileScenario(app);
    // A chain 4 levels deep: card > l1 > l2 > l3 (depth 3).
    const l1 = await newSubtask(card.id, 'L1');
    const l2 = await newSubtask(l1.id, 'L2');
    const l3 = await newSubtask(l2.id, 'L3');
    const top = await newCard('Top'); // depth 0

    let move!: Promise<Answer>;
    let add!: Promise<Answer>;
    await holdingCards([top.id], async () => {
      // Top goes to depth 4, the deepest a card may be.
      move = ana.agent
        .put(`/api/cards/${top.id}/parent`)
        .send({ parentId: l3.id })
        .then((r) => r);
      await waitersOnLocks(1);
      // So a subtask of Top would be a 6th level.
      add = ana.agent
        .post(`/api/cards/${top.id}/subtasks`)
        .send({ columnId: toDo.id, title: 'Too deep' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const moved = await move;
    const added = await add;
    expect(moved.status).toBe(200);

    const topNow = await prisma.card.findUniqueOrThrow({
      where: { id: top.id },
    });
    expect(topNow.depth).toBe(4);
    expect(
      added.status,
      `subtask saved at depth ${JSON.stringify((added.body as { depth?: number }).depth)}`,
    ).toBe(409);
  }, 20_000);

  it('stores the right depth and number for a subtask added while its parent is moved deeper, when it still fits', async () => {
    const { ana, card, newCard, newSubtask, toDo } = await fileScenario(app);
    const l1 = await newSubtask(card.id, 'L1'); // depth 1
    const top = await newCard('Top');

    let move!: Promise<Answer>;
    let add!: Promise<Answer>;
    await holdingCards([top.id], async () => {
      move = ana.agent
        .put(`/api/cards/${top.id}/parent`)
        .send({ parentId: l1.id })
        .then((r) => r);
      await waitersOnLocks(1);
      add = ana.agent
        .post(`/api/cards/${top.id}/subtasks`)
        .send({ columnId: toDo.id, title: 'Fits' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    expect((await move).status).toBe(200);
    const added = await add;
    expect(added.status, JSON.stringify(added.body)).toBe(201);

    const topNow = await prisma.card.findUniqueOrThrow({
      where: { id: top.id },
    });
    const sub = await prisma.card.findUniqueOrThrow({
      where: { id: (added.body as { id: string }).id },
    });
    expect(topNow.depth).toBe(2);
    expect(sub.parentId).toBe(top.id);
    expect(sub.depth).toBe(3);
    expect(sub.numberPath).toBe(`${topNow.numberPath}.1`);
  }, 20_000);

  it('does not answer 500 when a subtask is added to a card while it is being deleted', async () => {
    const { ana, card, toDo } = await fileScenario(app);

    let add!: Promise<Answer>;
    let del!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      add = ana.agent
        .post(`/api/cards/${card.id}/subtasks`)
        .send({ columnId: toDo.id, title: 'Late' })
        .then((r) => r);
      await waitersOnLocks(1);
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(2);
    });
    const added = await add;
    const deleted = await del;
    expect(
      [added.status, deleted.status],
      JSON.stringify([added.body, deleted.body]),
    ).not.toContain(500);
  }, 20_000);

  it('answers 404 when a subtask is added to a card that is deleted while the request waits', async () => {
    const { ana, card, toDo } = await fileScenario(app);

    let del!: Promise<Answer>;
    let add!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
      add = ana.agent
        .post(`/api/cards/${card.id}/subtasks`)
        .send({ columnId: toDo.id, title: 'Late' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    expect((await del).status).toBe(204);
    const added = await add;
    expect(added.status, JSON.stringify(added.body)).toBe(404);
    expect(messageOf(added)).toBe('Card not found');
  }, 20_000);

  it('does not answer 500 when time is logged on a card while it is being deleted', async () => {
    const { ana, card } = await fileScenario(app);

    let del!: Promise<Answer>;
    let log!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
      log = ana.agent
        .post(`/api/cards/${card.id}/time-entries`)
        .send({ minutes: 30, workDate: '2026-11-01' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const deleted = await del;
    const logged = await log;
    expect(deleted.status).toBe(204);
    expect(logged.status, JSON.stringify(logged.body)).toBe(404);
    expect(messageOf(logged)).toBe('Card not found');
  }, 20_000);

  it('answers 404 when an assignee is added to a card that is deleted while the request waits', async () => {
    const { ana, card } = await fileScenario(app);

    let del!: Promise<Answer>;
    let assign!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
      assign = ana.agent
        .put(`/api/cards/${card.id}/assignees/${ana.user.id}`)
        .then((r) => r);
      await waitersOnLocks(2);
    });
    expect((await del).status).toBe(204);
    const assigned = await assign;
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(404);
    expect(messageOf(assigned)).toBe('Card not found');
  }, 20_000);

  it('answers 404 when a checklist is added to a card that is deleted while the request waits', async () => {
    const { ana, card } = await fileScenario(app);

    let del!: Promise<Answer>;
    let add!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
      add = ana.agent
        .post(`/api/cards/${card.id}/checklists`)
        .send({ name: 'Steps' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    expect((await del).status).toBe(204);
    const added = await add;
    expect(added.status, JSON.stringify(added.body)).toBe(404);
    expect(messageOf(added)).toBe('Card not found');
  }, 20_000);

  it('refuses to delete a card whose subtask was moved elsewhere while the delete waited, and changes nothing', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub'); // 1.1
    const below = await newSubtask(sub.id, 'Below'); // 1.1.1
    let other = await newCard('Other parent');
    while (
      (await prisma.card.findUniqueOrThrow({ where: { id: other.id } }))
        .numberPath.length < 2
    ) {
      other = await newCard('Other parent');
    }

    let moveSub!: Promise<Answer>;
    let deleteCard!: Promise<Answer>;
    await holdingCards([card.id], async () => {
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
    });
    const moved = await moveSub;
    const deleted = await deleteCard;
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(409);
    expect(messageOf(deleted)).toBe(CHANGED);

    // Nothing changed: the card is still there, the subtask is where it was moved.
    expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
    const s = await prisma.card.findUniqueOrThrow({ where: { id: sub.id } });
    const o = await prisma.card.findUniqueOrThrow({ where: { id: other.id } });
    const b = await prisma.card.findUniqueOrThrow({ where: { id: below.id } });
    expect(s.parentId).toBe(other.id);
    expect(s.depth).toBe(1);
    expect(s.numberPath.startsWith(`${o.numberPath}.`)).toBe(true);
    expect(b.parentId).toBe(sub.id);
    expect(b.numberPath).toBe(`${s.numberPath}.1`);
    expect(b.depth).toBe(2);
  }, 20_000);

  it('does not answer 500 when the same checklist item is turned into a subtask twice at once', async () => {
    const { ana, card } = await fileScenario(app);
    const list = (
      await ana.agent
        .post(`/api/cards/${card.id}/checklists`)
        .send({ name: 'Steps' })
        .expect(201)
    ).body as { id: string };
    const item = (
      await ana.agent
        .post(`/api/checklists/${list.id}/items`)
        .send({ text: 'Do it' })
        .expect(201)
    ).body as { id: string };

    let first!: Promise<Answer>;
    let second!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      first = ana.agent
        .post(`/api/checklist-items/${item.id}/subtask`)
        .then((r) => r);
      await waitersOnLocks(1);
      second = ana.agent
        .post(`/api/checklist-items/${item.id}/subtask`)
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const answers = [await first, await second];
    expect(
      answers.map((a) => a.status).sort((x, y) => x - y),
      JSON.stringify(answers.map((a) => a.body)),
    ).toEqual([201, 404]);
    expect(await prisma.card.count({ where: { parentId: card.id } })).toBe(1);
  }, 20_000);

  it('gives the subtask the item text as it is when the change runs, not as it was when the request came in', async () => {
    const { ana, card } = await fileScenario(app);
    const list = (
      await ana.agent
        .post(`/api/cards/${card.id}/checklists`)
        .send({ name: 'Steps' })
        .expect(201)
    ).body as { id: string };
    const item = (
      await ana.agent
        .post(`/api/checklists/${list.id}/items`)
        .send({ text: 'Old text' })
        .expect(201)
    ).body as { id: string };

    let turn!: Promise<Answer>;
    // The edit commits at the moment the card lock is let go.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM cards WHERE id = ${card.id}::uuid FOR UPDATE`;
        turn = ana.agent
          .post(`/api/checklist-items/${item.id}/subtask`)
          .then((r) => r);
        await waitersOnLocks(1);
        await tx.checklistItem.update({
          where: { id: item.id },
          data: { text: 'New text' },
        });
      },
      { timeout: 20_000 },
    );
    const turned = await turn;
    expect(turned.status, JSON.stringify(turned.body)).toBe(201);
    expect((turned.body as { title: string }).title).toBe('New text');
  }, 20_000);

  it('does not answer 500 when a card is renamed while it is being deleted', async () => {
    const { ana, card } = await fileScenario(app);

    let del!: Promise<Answer>;
    let rename!: Promise<Answer>;
    await holdingCards([card.id], async () => {
      del = ana.agent.delete(`/api/cards/${card.id}`).then((r) => r);
      await waitersOnLocks(1);
      rename = ana.agent
        .patch(`/api/cards/${card.id}`)
        .send({ title: 'New title' })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const deleted = await del;
    const renamed = await rename;
    expect(deleted.status).toBe(204);
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(404);
    expect(messageOf(renamed)).toBe('Card not found');
  }, 20_000);
});
