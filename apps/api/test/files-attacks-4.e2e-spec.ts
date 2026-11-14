import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { fileScenario, upload } from './support/files-scenario.js';
import { closeAllSockets, startLiveApp } from './support/live.js';
import { emptyBucket } from './support/storage.js';

// Antagonist, round 4: what the round-3 locking still leaves open.
describe('Card changes at the same moment, attacks round 4 (e2e)', () => {
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

  type Answer = { status: number; body: unknown };

  const CHANGED = 'Someone changed this card at the same time. Try again.';

  function messageOf(a: Answer): unknown {
    return (a.body as { message?: unknown }).message;
  }

  async function holdingCards(
    cardIds: string[],
    during: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        for (const id of cardIds) {
          await tx.$queryRaw`SELECT id FROM cards WHERE id = ${id}::uuid FOR UPDATE`;
        }
        await during(tx);
      },
      { timeout: 20_000 },
    );
  }

  function aFile(
    tx: Prisma.TransactionClient,
    projectId: string,
    cardId: string,
    name: string,
  ) {
    return tx.file.create({
      data: {
        projectId,
        cardId,
        name,
        size: 3,
        mimeType: 'application/octet-stream',
        storageKey: `files/${randomUUID()}`,
      },
    });
  }

  it('answers 404, not 500, when a checklist item is deleted while it is being turned into a subtask, and adds no subtask', async () => {
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

    let turn!: Promise<Answer>;
    // Another person deletes the item (DELETE /checklist-items/:id takes no
    // card lock) after the turn has read it, before it deletes it.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM checklist_items WHERE id = ${item.id}::uuid FOR UPDATE`;
        turn = ana.agent
          .post(`/api/checklist-items/${item.id}/subtask`)
          .then((r) => r);
        await waitersOnLocks(1);
        await tx.checklistItem.delete({ where: { id: item.id } });
      },
      { timeout: 20_000 },
    );
    const turned = await turn;
    expect(turned.status, JSON.stringify(turned.body)).toBe(404);
    expect(messageOf(turned)).toBe('Checklist item not found');
    expect(await prisma.card.count({ where: { parentId: card.id } })).toBe(0);
  }, 20_000);
  it('answers 404, not 500, when the person deleting a card is removed from the project while the delete waits', async () => {
    const { cara, project, toDo } = await fileScenario(app);
    const own = (
      await cara.agent
        .post(`/api/columns/${toDo.id}/cards`)
        .send({ title: 'Cara made this' })
        .expect(201)
    ).body as { id: string };
    const caraId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'cara@example.com' },
      })
    ).id;

    let removal!: Promise<Answer>;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM cards WHERE id = ${own.id}::uuid FOR UPDATE`;
        removal = cara.agent.delete(`/api/cards/${own.id}`).then((r) => r);
        await waitersOnLocks(1);
        // An admin removes Cara at this moment.
        await tx.projectMember.delete({
          where: {
            projectId_userId: { projectId: project.id, userId: caraId },
          },
        });
      },
      { timeout: 20_000 },
    );
    const answer = await removal;
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect(messageOf(answer)).toBe('Card not found');
    expect(await prisma.card.count({ where: { id: own.id } })).toBe(1);
  }, 20_000);

  // There is no limit on subtasks (Jon, 2026-11-14), so this delete must
  // succeed however long it takes. On main it answers 204 in about 3.9 s; the
  // per-subtask lockUntilCovered rounds push it past Prisma's 5 s transaction
  // limit. The generous test timeout is for a slow machine.
  it('deletes a card whose 500 direct subtasks are all made cards of their own', async () => {
    const { ana, card, newSubtask } = await fileScenario(app);
    const subtaskIds: string[] = [];
    for (let i = 0; i < 500; i++) {
      subtaskIds.push((await newSubtask(card.id, `Step ${i}`)).id);
    }
    const subtasks = Object.fromEntries(
      subtaskIds.map((id) => [id, { action: 'standalone' }]),
    );

    const answer = await ana.agent
      .delete(`/api/cards/${card.id}`)
      .send({ subtasks });

    expect(answer.status, JSON.stringify(answer.body)).toBe(204);
    expect(await prisma.card.count({ where: { id: card.id } })).toBe(0);
  }, 300_000);
  it('answers 404, not 500, when a label is deleted while it is being put on a card', async () => {
    const { ana, card, project } = await fileScenario(app);
    const label = (
      await ana.agent
        .post(`/api/projects/${project.id}/labels`)
        .send({ name: 'Bug', colour: 'RED' })
        .expect(201)
    ).body as { id: string };

    let put!: Promise<Answer>;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM cards WHERE id = ${card.id}::uuid FOR UPDATE`;
        put = ana.agent
          .put(`/api/cards/${card.id}/labels/${label.id}`)
          .then((r) => r);
        await waitersOnLocks(1);
        // An admin deletes the label at this moment.
        await tx.label.delete({ where: { id: label.id } });
      },
      { timeout: 20_000 },
    );
    const answer = await put;
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect(messageOf(answer)).toBe('Label not found');
  }, 20_000);

  // Decided by Jon, 2026-11-14: someone removed from the project while their
  // change waits gets 404 "Card not found", like any outsider.
  it('answers 404 "Card not found" when an uploader is removed from the project while removing their own file', async () => {
    const { cara, card, project } = await fileScenario(app);
    const file = (
      await upload(cara.agent, card.id, {
        filename: 'mine.txt',
        data: 'abc',
      }).expect(201)
    ).body as { id: string };
    const caraId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'cara@example.com' },
      })
    ).id;

    let removal!: Promise<Answer>;
    await holdingCards([card.id], async (tx) => {
      removal = cara.agent.delete(`/api/files/${file.id}`).then((r) => r);
      await waitersOnLocks(1);
      await tx.projectMember.delete({
        where: {
          projectId_userId: { projectId: project.id, userId: caraId },
        },
      });
    });
    const answer = await removal;
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect(messageOf(answer)).toBe('Card not found');
    expect(await prisma.file.count({ where: { id: file.id } })).toBe(1);
  }, 20_000);

  // Files seen: the delete dialog sends `filesSeen`, in the JSON body next to
  // the subtask choices, as the number of files it showed on the cards that
  // will be deleted (the card and the subtasks chosen for deletion). It is
  // checked only with files=delete or moveFilesTo. If the number of files on
  // those cards is not what was seen, the answer is 409 and nothing changes.
  describe('files seen by the person deleting a card', () => {
    async function oneFile(
      agent: Parameters<typeof upload>[0],
      cardId: string,
      name: string,
    ) {
      return (
        await upload(agent, cardId, { filename: name, data: 'abc' }).expect(201)
      ).body as { id: string };
    }

    it('deletes the card and its files when the number of files is what the person saw', async () => {
      const { ana, card } = await fileScenario(app);
      await oneFile(ana.agent, card.id, 'a.txt');

      const answer = await ana.agent
        .delete(`/api/cards/${card.id}?files=delete`)
        .send({ filesSeen: 1 });

      expect(answer.status, JSON.stringify(answer.body)).toBe(204);
      expect(await prisma.card.count({ where: { id: card.id } })).toBe(0);
      expect(await prisma.file.count()).toBe(0);
    });

    it('answers 409 and deletes nothing when a file was attached while a files=delete waited', async () => {
      const { ana, card, project } = await fileScenario(app);
      await oneFile(ana.agent, card.id, 'a.txt');

      let del!: Promise<Answer>;
      await holdingCards([card.id], async (tx) => {
        del = ana.agent
          .delete(`/api/cards/${card.id}?files=delete`)
          .send({ filesSeen: 1 })
          .then((r) => r);
        await waitersOnLocks(1);
        await aFile(tx, project.id, card.id, 'late.txt');
      });
      const answer = await del;

      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect(messageOf(answer)).toBe(CHANGED);
      expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
      expect(await prisma.file.count({ where: { cardId: card.id } })).toBe(2);
    }, 20_000);

    it('answers 409 and deletes nothing when a file was removed while a files=delete waited', async () => {
      const { ana, card } = await fileScenario(app);
      const first = await oneFile(ana.agent, card.id, 'a.txt');
      await oneFile(ana.agent, card.id, 'b.txt');

      let del!: Promise<Answer>;
      await holdingCards([card.id], async (tx) => {
        del = ana.agent
          .delete(`/api/cards/${card.id}?files=delete`)
          .send({ filesSeen: 2 })
          .then((r) => r);
        await waitersOnLocks(1);
        await tx.file.delete({ where: { id: first.id } });
      });
      const answer = await del;

      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect(messageOf(answer)).toBe(CHANGED);
      expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
      expect(await prisma.file.count({ where: { cardId: card.id } })).toBe(1);
    }, 20_000);

    it('answers 409 and changes nothing when a file was attached while a moveFilesTo waited', async () => {
      const { ana, card, newCard, project } = await fileScenario(app);
      const target = await newCard('Target');
      await oneFile(ana.agent, card.id, 'a.txt');

      let del!: Promise<Answer>;
      await holdingCards([card.id], async (tx) => {
        del = ana.agent
          .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
          .send({ filesSeen: 1 })
          .then((r) => r);
        await waitersOnLocks(1);
        await aFile(tx, project.id, card.id, 'late.txt');
      });
      const answer = await del;

      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect(messageOf(answer)).toBe(CHANGED);
      expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
      expect(await prisma.file.count({ where: { cardId: card.id } })).toBe(2);
      expect(await prisma.file.count({ where: { cardId: target.id } })).toBe(0);
    }, 20_000);

    it('answers 409 and deletes nothing when a file was attached to a subtask chosen for deletion', async () => {
      const { ana, card, newSubtask, project } = await fileScenario(app);
      const sub = await newSubtask(card.id, 'Sub');
      await oneFile(ana.agent, card.id, 'a.txt');
      await oneFile(ana.agent, sub.id, 'b.txt');

      let del!: Promise<Answer>;
      await holdingCards([card.id], async (tx) => {
        del = ana.agent
          .delete(`/api/cards/${card.id}?files=delete`)
          .send({ filesSeen: 2, subtasks: { [sub.id]: { action: 'delete' } } })
          .then((r) => r);
        await waitersOnLocks(1);
        await aFile(tx, project.id, sub.id, 'late.txt');
      });
      const answer = await del;

      expect(answer.status, JSON.stringify(answer.body)).toBe(409);
      expect(messageOf(answer)).toBe(CHANGED);
      expect(await prisma.card.count({ where: { id: sub.id } })).toBe(1);
      expect(await prisma.file.count()).toBe(3);
    }, 20_000);

    it('does not count the files of a subtask that is made a card of its own', async () => {
      const { ana, card, newSubtask, project } = await fileScenario(app);
      const sub = await newSubtask(card.id, 'Sub');
      await oneFile(ana.agent, card.id, 'a.txt');

      let del!: Promise<Answer>;
      await holdingCards([card.id], async (tx) => {
        del = ana.agent
          .delete(`/api/cards/${card.id}?files=delete`)
          .send({
            filesSeen: 1,
            subtasks: { [sub.id]: { action: 'standalone' } },
          })
          .then((r) => r);
        await waitersOnLocks(1);
        await aFile(tx, project.id, sub.id, 'late.txt');
      });
      const answer = await del;

      expect(answer.status, JSON.stringify(answer.body)).toBe(204);
      expect(await prisma.file.count({ where: { cardId: sub.id } })).toBe(1);
    }, 20_000);

    it('refuses a filesSeen that is not a whole number of zero or more', async () => {
      const { ana, card } = await fileScenario(app);
      for (const filesSeen of [-1, 1.5, '1', null]) {
        const answer = await ana.agent
          .delete(`/api/cards/${card.id}?files=delete`)
          .send({ filesSeen });
        expect(answer.status, JSON.stringify(filesSeen)).toBe(400);
      }
      expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
    });
  });

  // Reviewer, round 4.
  it('answers 409 (subtasks changed), not 404, when a direct subtask is deleted while its parent’s delete waits', async () => {
    const { ana, card, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub');

    let deleteSub!: Promise<Answer>;
    let deleteCard!: Promise<Answer>;
    await holdingCards([sub.id], async () => {
      deleteSub = ana.agent.delete(`/api/cards/${sub.id}`).then((r) => r);
      await waitersOnLocks(1);
      deleteCard = ana.agent
        .delete(`/api/cards/${card.id}`)
        .send({ subtasks: { [sub.id]: { action: 'standalone' } } })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const answers = [await deleteSub, await deleteCard];

    expect(
      answers.map((a) => a.status),
      JSON.stringify(answers.map((a) => a.body)),
    ).toEqual([204, 409]);
    expect(messageOf(answers[1]!)).toBe(CHANGED);
    expect(await prisma.card.count({ where: { id: card.id } })).toBe(1);
  }, 20_000);

  it('moves a card whose grandchild is deleted while the move waits', async () => {
    const { ana, card, newCard, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub');
    const grand = await newSubtask(sub.id, 'Grand');
    const other = await newCard('Other');

    let move!: Promise<Answer>;
    await holdingCards([grand.id], async (tx) => {
      move = ana.agent
        .put(`/api/cards/${sub.id}/parent`)
        .send({ parentId: other.id })
        .then((r) => r);
      await waitersOnLocks(1);
      // Its chat is kept, without a card, as when a card is deleted.
      await tx.chat.updateMany({
        where: { cardId: grand.id },
        data: { cardId: null },
      });
      await tx.card.delete({ where: { id: grand.id } });
    });
    const answer = await move;

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const s = await prisma.card.findUniqueOrThrow({ where: { id: sub.id } });
    expect(s.parentId).toBe(other.id);
    expect(s.depth).toBe(1);
  }, 20_000);

  it('makes a card top-level when its old parent is deleted while the move waits', async () => {
    const { ana, card, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub');

    let deleteParent!: Promise<Answer>;
    let makeTop!: Promise<Answer>;
    await holdingCards([sub.id], async () => {
      deleteParent = ana.agent
        .delete(`/api/cards/${card.id}`)
        .send({ subtasks: { [sub.id]: { action: 'standalone' } } })
        .then((r) => r);
      await waitersOnLocks(1);
      makeTop = ana.agent
        .put(`/api/cards/${sub.id}/parent`)
        .send({ parentId: null })
        .then((r) => r);
      await waitersOnLocks(2);
    });
    const answers = [await deleteParent, await makeTop];

    expect(
      answers.map((a) => a.status),
      JSON.stringify(answers.map((a) => a.body)),
    ).toEqual([204, 200]);
    const s = await prisma.card.findUniqueOrThrow({ where: { id: sub.id } });
    expect(s.parentId).toBeNull();
    expect(s.depth).toBe(0);
  }, 20_000);
});
