import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Message } from '@tessera/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import {
  closeAllSockets,
  connect,
  isLetIn,
  join,
  LIVE_HEADER,
  type LiveClient,
  type LiveSignal,
  quiet,
  signInCookie,
  signOutWith,
  startLiveApp,
  until,
} from './support/live.js';
import { resetDatabase } from './support/reset-database.js';

// Live updates PR (plan "live updates"): Socket.IO connections, board rooms
// and "something changed" signals (acceptance criteria 1 to 12).
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Live updates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await startLiveApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterEach(() => {
    closeAllSockets();
  });

  afterAll(async () => {
    await app.close();
  });

  // Ana (admin), Cara (member) and Ben (not a member) as in boardScenario.
  // Cara and Ana each have a live connection in the board's room, and
  // `by` is the connection id Ana sends with her saves.
  async function setUp() {
    const scenario = await boardScenario(app);
    const anaLive = await connect(app, await signInCookie(app, 'ana'));
    const caraLive = await connect(app, await signInCookie(app, 'cara'));
    expect(await join(anaLive, scenario.board.id)).toBe(true);
    expect(await join(caraLive, scenario.board.id)).toBe(true);
    const chats = (await scenario.ana.agent.get(
      `/api/boards/${scenario.board.id}/chats`,
    )) as { body: { id: string; kind: string }[] };
    const general = chats.body.find((c) => c.kind === 'GENERAL')!;
    return { ...scenario, anaLive, caraLive, by: anaLive.id, general };
  }

  type Scenario = Awaited<ReturnType<typeof setUp>>;

  const signalsOf = (who: LiveClient, type: LiveSignal['type']) =>
    who.signals.filter((s) => s.type === type);

  async function sees(who: LiveClient, expected: Partial<LiveSignal>) {
    await until(
      () =>
        who.signals.some((s) =>
          Object.entries(expected).every(
            ([key, value]) => s[key as keyof LiveSignal] === value,
          ),
        ),
      `signal ${JSON.stringify(expected)}; got ${JSON.stringify(who.signals)}`,
    );
  }

  describe('connecting (criterion 1)', () => {
    // 1
    it('refuses a connection without a valid session cookie, and lets one with a session in', async () => {
      await boardScenario(app);

      expect(await isLetIn(app, await signInCookie(app, 'ana'))).toBe(true);
      expect(await isLetIn(app)).toBe(false);
      expect(await isLetIn(app, 'tessera_session=not-a-real-session')).toBe(
        false,
      );
    });
  });

  describe('rooms (criteria 2 to 4)', () => {
    // 2
    it('lets a member join their board, and refuses a non-member and an unknown board', async () => {
      const { board } = await setUp();
      const ben = await connect(app, await signInCookie(app, 'ben'));
      const cara = await connect(app, await signInCookie(app, 'cara'));

      expect(await join(cara, board.id)).toBe(true);
      expect(await join(ben, board.id)).toBe(false);
      expect(await join(cara, UNKNOWN_ID)).toBe(false);
      expect(await join(cara, 'not-an-id')).toBe(false);
    });

    // 2
    it('sends nothing from a board to someone whose join was refused', async () => {
      const { ana, card, board, caraLive, by } = await setUp();
      const ben = await connect(app, await signInCookie(app, 'ben'));
      expect(await join(ben, board.id)).toBe(false);

      await ana.agent
        .patch(`/api/cards/${card.id}`)
        .set('X-Live-Connection', by)
        .send({ title: 'Changed' })
        .expect(200);

      await sees(caraLive, { type: 'card', cardId: card.id });
      await quiet();
      expect(ben.signals).toEqual([]);
    });

    // 3
    it('stops sending a board’s signals to someone removed from the project, without reconnecting', async () => {
      const { ana, cara, project, card, board, anaLive, caraLive } =
        await setUp();
      await ana.agent
        .patch(`/api/cards/${card.id}`)
        .send({ title: 'First' })
        .expect(200);
      await sees(caraLive, { type: 'card', cardId: card.id });
      caraLive.signals.length = 0;
      anaLive.signals.length = 0;

      await ana.agent
        .delete(`/api/projects/${project.id}/members/${cara.user.id}`)
        .expect(204);
      await ana.agent
        .patch(`/api/cards/${card.id}`)
        .send({ title: 'Second' })
        .expect(200);

      await sees(anaLive, { type: 'card', boardId: board.id });
      await quiet();
      expect(caraLive.signals).toEqual([]);
      expect(caraLive.socket.connected).toBe(true);
    });

    // 4
    it('ends the live connections of a session that signs out, and leaves the others', async () => {
      await boardScenario(app);
      const cookie = await signInCookie(app, 'ana');
      const first = await connect(app, cookie);
      const second = await connect(app, cookie);
      const otherSession = await connect(app, await signInCookie(app, 'ana'));

      await signOutWith(app, cookie);

      await until(
        () => !first.socket.connected && !second.socket.connected,
        'the signed-out session’s connections to close',
      );
      await quiet();
      expect(otherSession.socket.connected).toBe(true);
    });
  });

  describe('signal shape (criterion 5)', () => {
    // 5
    it('is { type, boardId, cardId, by } with `by` the connection id sent with the save', async () => {
      const { ana, card, board, caraLive, by } = await setUp();

      await ana.agent
        .patch(`/api/cards/${card.id}`)
        .set(LIVE_HEADER, by)
        .send({ title: 'A very secret title' })
        .expect(200);

      await sees(caraLive, { type: 'card' });
      expect(signalsOf(caraLive, 'card')[0]).toEqual({
        type: 'card',
        boardId: board.id,
        cardId: card.id,
        by,
      });
    });

    // 5
    it('has `by` null when the save carried no connection id', async () => {
      const { ana, card, board, caraLive } = await setUp();

      await ana.agent
        .patch(`/api/cards/${card.id}`)
        .send({ title: 'Changed' })
        .expect(200);

      await sees(caraLive, { type: 'card' });
      expect(signalsOf(caraLive, 'card')[0]).toEqual({
        type: 'card',
        boardId: board.id,
        cardId: card.id,
        by: null,
      });
    });

    // 5
    it('never holds text, names or other card content', async () => {
      const { ana, caraLive, general, by } = await setUp();

      await ana.agent
        .post(`/api/chats/${general.id}/messages`)
        .set(LIVE_HEADER, by)
        .send({ body: 'Top secret words' })
        .expect(201);
      await sees(caraLive, { type: 'message' });
      const sent = JSON.stringify(caraLive.signals);
      expect(sent).not.toContain('secret');
      expect(sent).not.toContain('ana@example.com');
      for (const signal of caraLive.signals) {
        expect(Object.keys(signal).sort()).toEqual(
          ['boardId', 'by', 'chatId', 'messageId', 'type'].sort(),
        );
      }
    });
  });

  describe('card signals (criterion 6)', () => {
    // What each change does: the card it signals, and whether the board is
    // signalled too (create, move and delete).
    interface Done {
      cardId: string;
      alsoBoard?: boolean;
    }
    type Change = (s: Scenario) => Promise<Done>;

    const patchCard =
      (changes: object): Change =>
      async (s) => {
        await s.ana.agent
          .patch(s.cardUrl)
          .set(LIVE_HEADER, s.by)
          .send(changes)
          .expect(200);
        return { cardId: s.card.id };
      };

    async function checklistOf(s: Scenario) {
      return (
        await s.ana.agent
          .post(`${s.cardUrl}/checklists`)
          .send({ name: 'Testing' })
          .expect(201)
      ).body as { id: string };
    }

    async function itemOf(s: Scenario) {
      const list = await checklistOf(s);
      return (
        await s.ana.agent
          .post(`/api/checklists/${list.id}/items`)
          .send({ text: 'Chrome' })
          .expect(201)
      ).body as { id: string };
    }

    async function entryOf(s: Scenario) {
      return (
        await s.ana.agent
          .post(`${s.cardUrl}/time-entries`)
          .send({ minutes: 30, workDate: '2026-10-01' })
          .expect(201)
      ).body as { id: string };
    }

    const changes: [string, Change][] = [
      [
        'creates a card',
        async (s) => {
          const created = await s.ana.agent
            .post(`/api/columns/${s.toDo.id}/cards`)
            .set(LIVE_HEADER, s.by)
            .send({ title: 'New card' })
            .expect(201);
          return { cardId: created.body.id as string, alsoBoard: true };
        },
      ],
      ['edits the title', patchCard({ title: 'Sign in' })],
      ['edits the description', patchCard({ description: 'Email first' })],
      ['edits the estimate', patchCard({ estimateMinutes: 90 })],
      ['edits the priority', patchCard({ priority: 'HIGH' })],
      ['edits the due date', patchCard({ due: { date: '2026-11-20' } })],
      [
        'moves a card',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/move`)
            .set(LIVE_HEADER, s.by)
            .send({ columnId: s.inProgress.id })
            .expect(200);
          return { cardId: s.card.id, alsoBoard: true };
        },
      ],
      [
        'completes a card',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/complete`)
            .set(LIVE_HEADER, s.by)
            .send({})
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'reopens a card',
        async (s) => {
          await s.ana.agent.post(`${s.cardUrl}/complete`).send({}).expect(200);
          await s.ana.agent
            .post(`${s.cardUrl}/reopen`)
            .set(LIVE_HEADER, s.by)
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'deletes a card',
        async (s) => {
          await s.ana.agent
            .delete(s.cardUrl)
            .set(LIVE_HEADER, s.by)
            .send({})
            .expect(204);
          return { cardId: s.card.id, alsoBoard: true };
        },
      ],
      [
        'adds an assignee',
        async (s) => {
          await s.ana.agent
            .put(`${s.cardUrl}/assignees/${s.cara.user.id}`)
            .set(LIVE_HEADER, s.by)
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'removes an assignee',
        async (s) => {
          await s.ana.agent
            .put(`${s.cardUrl}/assignees/${s.cara.user.id}`)
            .expect(200);
          await s.ana.agent
            .delete(`${s.cardUrl}/assignees/${s.cara.user.id}`)
            .set(LIVE_HEADER, s.by)
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'puts a label on a card',
        async (s) => {
          const bug = await s.ana.agent
            .post(`/api/projects/${s.project.id}/labels`)
            .send({ name: 'Bug', colour: 'RED' })
            .expect(201);
          await s.ana.agent
            .put(`${s.cardUrl}/labels/${bug.body.id as string}`)
            .set(LIVE_HEADER, s.by)
            .expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'takes a label off a card',
        async (s) => {
          const bug = await s.ana.agent
            .post(`/api/projects/${s.project.id}/labels`)
            .send({ name: 'Bug', colour: 'RED' })
            .expect(201);
          const url = `${s.cardUrl}/labels/${bug.body.id as string}`;
          await s.ana.agent.put(url).expect(204);
          await s.ana.agent.delete(url).set(LIVE_HEADER, s.by).expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'adds a checklist',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/checklists`)
            .set(LIVE_HEADER, s.by)
            .send({ name: 'Testing' })
            .expect(201);
          return { cardId: s.card.id };
        },
      ],
      [
        'renames a checklist',
        async (s) => {
          const list = await checklistOf(s);
          await s.ana.agent
            .patch(`/api/checklists/${list.id}`)
            .set(LIVE_HEADER, s.by)
            .send({ name: 'QA' })
            .expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'deletes a checklist',
        async (s) => {
          const list = await checklistOf(s);
          await s.ana.agent
            .delete(`/api/checklists/${list.id}`)
            .set(LIVE_HEADER, s.by)
            .expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'adds a checklist item',
        async (s) => {
          const list = await checklistOf(s);
          await s.ana.agent
            .post(`/api/checklists/${list.id}/items`)
            .set(LIVE_HEADER, s.by)
            .send({ text: 'Chrome' })
            .expect(201);
          return { cardId: s.card.id };
        },
      ],
      [
        'ticks a checklist item',
        async (s) => {
          const item = await itemOf(s);
          await s.ana.agent
            .patch(`/api/checklist-items/${item.id}`)
            .set(LIVE_HEADER, s.by)
            .send({ isDone: true })
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'deletes a checklist item',
        async (s) => {
          const item = await itemOf(s);
          await s.ana.agent
            .delete(`/api/checklist-items/${item.id}`)
            .set(LIVE_HEADER, s.by)
            .expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'adds a subtask',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/subtasks`)
            .set(LIVE_HEADER, s.by)
            .send({ columnId: s.toDo.id, title: 'Form' })
            .expect(201);
          return { cardId: s.card.id };
        },
      ],
      [
        'logs time',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/time-entries`)
            .set(LIVE_HEADER, s.by)
            .send({ minutes: 30, workDate: '2026-10-01' })
            .expect(201);
          return { cardId: s.card.id };
        },
      ],
      [
        'edits a time entry',
        async (s) => {
          const entry = await entryOf(s);
          await s.ana.agent
            .patch(`/api/time-entries/${entry.id}`)
            .set(LIVE_HEADER, s.by)
            .send({ minutes: 45 })
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
      [
        'deletes a time entry',
        async (s) => {
          const entry = await entryOf(s);
          await s.ana.agent
            .delete(`/api/time-entries/${entry.id}`)
            .set(LIVE_HEADER, s.by)
            .expect(204);
          return { cardId: s.card.id };
        },
      ],
      [
        'starts a timer',
        async (s) => {
          await s.ana.agent
            .post(`${s.cardUrl}/timer`)
            .set(LIVE_HEADER, s.by)
            .send({})
            .expect(201);
          return { cardId: s.card.id };
        },
      ],
      [
        'stops a timer',
        async (s) => {
          await s.ana.agent.post(`${s.cardUrl}/timer`).send({}).expect(201);
          await s.ana.agent
            .delete('/api/timer')
            .set(LIVE_HEADER, s.by)
            .expect(200);
          return { cardId: s.card.id };
        },
      ],
    ];

    // 6
    it.each(changes)(
      'sends a card signal to the board’s members when someone %s',
      async (_name, change) => {
        const s = await setUp();
        const before = s.caraLive.signals.length;

        const { cardId, alsoBoard } = await change(s);

        await sees(s.caraLive, {
          type: 'card',
          boardId: s.board.id,
          cardId,
          by: s.by,
        });
        if (alsoBoard) {
          await sees(s.caraLive, {
            type: 'board',
            boardId: s.board.id,
            by: s.by,
          });
        }
        expect(s.caraLive.signals.length).toBeGreaterThan(before);
      },
    );
  });

  describe('two boards (criterion 7)', () => {
    async function withSecondBoard() {
      const s = await setUp();
      const backlog = (
        await s.ana.agent
          .post(`/api/projects/${s.project.id}/boards`)
          .send({ name: 'Backlog' })
          .expect(201)
      ).body as { id: string };
      const ideas = (
        (await s.ana.agent.get(`/api/boards/${backlog.id}`).expect(200)).body
          .columns as { id: string }[]
      )[0]!;
      const otherLive = await connect(app, await signInCookie(app, 'cara'));
      expect(await join(otherLive, backlog.id)).toBe(true);
      return { ...s, backlog, ideas, otherLive };
    }

    // 7
    it('signals both boards when a subtask is added on another board', async () => {
      const s = await withSecondBoard();

      const subtask = (
        await s.ana.agent
          .post(`${s.cardUrl}/subtasks`)
          .set(LIVE_HEADER, s.by)
          .send({ columnId: s.ideas.id, title: 'Elsewhere' })
          .expect(201)
      ).body as { id: string };

      await sees(s.caraLive, {
        type: 'card',
        boardId: s.board.id,
        cardId: s.card.id,
      });
      await sees(s.otherLive, {
        type: 'card',
        boardId: s.backlog.id,
        cardId: subtask.id,
      });
    });

    // 7
    it('signals both boards when a card on another board becomes a subtask', async () => {
      const s = await withSecondBoard();
      const other = (
        await s.ana.agent
          .post(`/api/columns/${s.ideas.id}/cards`)
          .send({ title: 'Idea' })
          .expect(201)
      ).body as { id: string };
      s.caraLive.signals.length = 0;
      s.otherLive.signals.length = 0;

      await s.ana.agent
        .put(`/api/cards/${other.id}/parent`)
        .set(LIVE_HEADER, s.by)
        .send({ parentId: s.card.id })
        .expect(200);

      await sees(s.caraLive, {
        type: 'card',
        boardId: s.board.id,
        cardId: s.card.id,
      });
      await sees(s.otherLive, {
        type: 'card',
        boardId: s.backlog.id,
        cardId: other.id,
      });
    });
  });

  describe('chat signals (criterion 8)', () => {
    // 8
    it('sends a chats signal when a chat is created', async () => {
      const { ana, board, caraLive, by } = await setUp();

      await ana.agent
        .post(`/api/boards/${board.id}/chats`)
        .set(LIVE_HEADER, by)
        .send({ title: 'Release plan' })
        .expect(201);

      await sees(caraLive, { type: 'chats', boardId: board.id, by });
    });

    // 8
    it('sends a chats signal and a card signal when a chat is linked to a card and unlinked', async () => {
      const { ana, board, card, caraLive, by } = await setUp();
      const chat = (
        await ana.agent
          .post(`/api/boards/${board.id}/chats`)
          .send({ title: 'Release plan' })
          .expect(201)
      ).body as { id: string };
      // The card has a chat of its own; free it first.
      const cardChat = (
        (await ana.agent.get(`/api/cards/${card.id}`)).body as {
          chat: { id: string } | null;
        }
      ).chat;
      if (cardChat) {
        await ana.agent.delete(`/api/chats/${cardChat.id}/card`).expect(200);
      }
      caraLive.signals.length = 0;

      await ana.agent
        .put(`/api/chats/${chat.id}/card`)
        .set(LIVE_HEADER, by)
        .send({ cardId: card.id })
        .expect(200);
      await sees(caraLive, { type: 'chats', boardId: board.id, by });
      await sees(caraLive, {
        type: 'card',
        boardId: board.id,
        cardId: card.id,
        by,
      });

      caraLive.signals.length = 0;
      await ana.agent
        .delete(`/api/chats/${chat.id}/card`)
        .set(LIVE_HEADER, by)
        .expect(200);
      await sees(caraLive, { type: 'chats', boardId: board.id, by });
      await sees(caraLive, {
        type: 'card',
        boardId: board.id,
        cardId: card.id,
        by,
      });
    });
  });

  describe('message signals (criterion 9)', () => {
    // 9
    it('sends a message signal with the chat and message ids when a message is sent, edited and deleted', async () => {
      const { ana, board, general, caraLive, by } = await setUp();

      const sent = (
        await ana.agent
          .post(`/api/chats/${general.id}/messages`)
          .set(LIVE_HEADER, by)
          .send({ body: 'Hello' })
          .expect(201)
      ).body as Message;
      const expected: LiveSignal = {
        type: 'message',
        boardId: board.id,
        chatId: general.id,
        messageId: sent.id,
        by,
      };
      await sees(caraLive, expected);
      expect(signalsOf(caraLive, 'message')).toContainEqual(expected);

      caraLive.signals.length = 0;
      await ana.agent
        .patch(`/api/messages/${sent.id}`)
        .set(LIVE_HEADER, by)
        .send({ body: 'Hello again' })
        .expect(200);
      await sees(caraLive, expected);

      caraLive.signals.length = 0;
      await ana.agent
        .delete(`/api/messages/${sent.id}`)
        .set(LIVE_HEADER, by)
        .expect(200);
      await sees(caraLive, expected);
    });
  });

  describe('no signal without a save (criteria 10 and 11)', () => {
    // 10
    it('sends nothing when a save fails with 400, 403, 404 or 409', async () => {
      const { ana, cara, card, cardUrl, project, caraLive, anaLive } =
        await setUp();
      const bug = (
        await ana.agent
          .post(`/api/projects/${project.id}/labels`)
          .send({ name: 'Bug', colour: 'RED' })
          .expect(201)
      ).body as { id: string };
      await ana.agent
        .post(`${cardUrl}/time-entries`)
        .send({ minutes: 30, workDate: '2026-10-01' })
        .expect(201);
      await quiet();
      caraLive.signals.length = 0;
      anaLive.signals.length = 0;

      // 400: a blank title. 403: a plain member changes a label. 404: no
      // such card. 409: a card with logged time cannot be deleted.
      await ana.agent.patch(cardUrl).send({ title: '  ' }).expect(400);
      await cara.agent
        .patch(`/api/labels/${bug.id}`)
        .send({ name: 'Defect' })
        .expect(403);
      await ana.agent
        .patch(`/api/cards/${UNKNOWN_ID}`)
        .send({ title: 'Nope' })
        .expect(404);
      await ana.agent.delete(cardUrl).send({}).expect(409);
      // A save that works, so that anything wrongly sent before it has
      // arrived by the time this one does.
      await ana.agent.patch(cardUrl).send({ title: 'Fine' }).expect(200);

      await sees(caraLive, { type: 'card', cardId: card.id });
      await quiet();
      expect(caraLive.signals).toEqual([
        expect.objectContaining({ type: 'card', cardId: card.id }),
      ]);
    });

    // 11
    it('sends nothing to a member of another project, for any change', async () => {
      const { ana, board, cardUrl, toDo, general, caraLive } = await setUp();
      const ben = await connect(app, await signInCookie(app, 'ben'));
      const benProject = (
        await request(app.getHttpServer())
          .post('/api/projects')
          .set('Cookie', await signInCookie(app, 'ben'))
          .send({ name: 'Secret', code: 'SEC' })
          .expect(201)
      ).body as { id: string };
      const benBoard = (
        await request(app.getHttpServer())
          .post(`/api/projects/${benProject.id}/boards`)
          .set('Cookie', await signInCookie(app, 'ben'))
          .send({ name: 'Ben’s board' })
          .expect(201)
      ).body as { id: string };
      expect(await join(ben, benBoard.id)).toBe(true);
      expect(await join(ben, board.id)).toBe(false);

      await ana.agent.patch(cardUrl).send({ title: 'Changed' }).expect(200);
      await ana.agent
        .post(`/api/columns/${toDo.id}/cards`)
        .send({ title: 'Another' })
        .expect(201);
      await ana.agent
        .post(`/api/boards/${board.id}/chats`)
        .send({ title: 'Plans' })
        .expect(201);
      await ana.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Hello' })
        .expect(201);

      await sees(caraLive, { type: 'message' });
      await quiet();
      expect(ben.signals).toEqual([]);
    });
  });

  describe('GET /api/messages/:id (criterion 12)', () => {
    // No live connection is needed here.
    async function plainSetUp() {
      const scenario = await boardScenario(app);
      const chats = (await scenario.ana.agent.get(
        `/api/boards/${scenario.board.id}/chats`,
      )) as { body: { id: string; kind: string }[] };
      return {
        ...scenario,
        general: chats.body.find((c) => c.kind === 'GENERAL')!,
      };
    }

    // 12
    it('gives a member the one message, in the same shape as in the list', async () => {
      const { ana, cara, general } = await plainSetUp();
      const sent = (
        await ana.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ body: 'Hello **team**' })
          .expect(201)
      ).body as Message;

      const response = await cara.agent
        .get(`/api/messages/${sent.id}`)
        .expect(200);

      expect(response.body).toEqual(sent);
      const listed = (
        await cara.agent.get(`/api/chats/${general.id}/messages`).expect(200)
      ).body as { messages: Message[] };
      expect(response.body).toEqual(listed.messages[0]);
    });

    // 12
    it('shows an edited and a deleted message as they now are', async () => {
      const { ana, cara, general } = await plainSetUp();
      const sent = (
        await ana.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ body: 'Oops' })
          .expect(201)
      ).body as Message;
      await ana.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: 'Fixed' })
        .expect(200);
      expect(
        (await cara.agent.get(`/api/messages/${sent.id}`).expect(200)).body,
      ).toMatchObject({ body: 'Fixed', editedAt: expect.any(String) });

      await ana.agent.delete(`/api/messages/${sent.id}`).expect(200);

      expect(
        (await cara.agent.get(`/api/messages/${sent.id}`).expect(200)).body,
      ).toMatchObject({
        deletedAt: expect.any(String),
        deletedBy: { id: ana.user.id, displayName: 'ana' },
      });
    });

    // 12
    it('answers 404 "Message not found" to a non-member and for an unknown id, and 400 for a malformed id', async () => {
      const { ana, ben, general } = await plainSetUp();
      const sent = (
        await ana.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ body: 'Private' })
          .expect(201)
      ).body as Message;

      const refused = await ben.agent.get(`/api/messages/${sent.id}`);
      expect(refused.status).toBe(404);
      expect(refused.body.message).toBe('Message not found');
      const unknown = await ana.agent.get(`/api/messages/${UNKNOWN_ID}`);
      expect(unknown.status).toBe(404);
      expect(unknown.body.message).toBe('Message not found');
      await ana.agent.get('/api/messages/not-an-id').expect(400);
    });
  });
});
