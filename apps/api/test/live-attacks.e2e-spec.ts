import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import {
  closeAllSockets,
  connect,
  cookieOf,
  join,
  LIVE_HEADER,
  type LiveClient,
  type LiveSignal,
  quiet,
  signInCookie,
  startLiveApp,
  until,
} from './support/live.js';
import { resetDatabase } from './support/reset-database.js';
import { testPassword } from './support/test-app.js';

// Live updates PR, review and attack fixes (criteria 34 to 36 and 42). The
// first four tests are the antagonist's proofs, kept as regression tests.
describe('Live updates: review and attack fixes (e2e)', () => {
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

  // Ana (admin) and Cara (member), each with a live connection in the
  // board's room that belongs to the session of their agent.
  async function setUp() {
    const scenario = await boardScenario(app);
    const anaLive = await connect(app, cookieOf(scenario.ana.agent));
    const caraLive = await connect(app, cookieOf(scenario.cara.agent));
    expect(await join(anaLive, scenario.board.id)).toBe(true);
    expect(await join(caraLive, scenario.board.id)).toBe(true);
    return { ...scenario, anaLive, caraLive };
  }

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

  describe('who a save is attributed to (criterion 34)', () => {
    // 34
    it('names the connection when the save and the connection are of the same session', async () => {
      const s = await setUp();

      await s.ana.agent
        .patch(s.cardUrl)
        .set(LIVE_HEADER, s.anaLive.id)
        .send({ title: 'By Ana' })
        .expect(200);

      await sees(s.caraLive, { type: 'card', cardId: s.card.id });
      expect(s.caraLive.signals[0]!.by).toBe(s.anaLive.id);
    });

    // 34 (antagonist proof)
    it('has `by` null when a member names another member’s connection, so that tab still shows the change', async () => {
      const s = await setUp();

      await s.cara.agent
        .patch(s.cardUrl)
        .set(LIVE_HEADER, s.anaLive.id)
        .send({ title: 'Changed by Cara' })
        .expect(200);

      await sees(s.anaLive, { type: 'card', cardId: s.card.id });
      expect(s.anaLive.signals.map((signal) => signal.by)).toEqual([null]);
    });

    // 34
    it('has `by` null when the connection is of the same person but another session', async () => {
      const s = await setUp();
      const otherSession = await connect(app, await signInCookie(app, 'ana'));

      await s.ana.agent
        .patch(s.cardUrl)
        .set(LIVE_HEADER, otherSession.id)
        .send({ title: 'From another session' })
        .expect(200);

      await sees(s.caraLive, { type: 'card', cardId: s.card.id });
      expect(s.caraLive.signals[0]!.by).toBeNull();
    });

    // 34
    it('has `by` null when the connection named has closed', async () => {
      const s = await setUp();
      const closing = await connect(app, cookieOf(s.ana.agent));
      const gone = closing.id;
      closing.socket.close();
      await quiet();

      await s.ana.agent
        .patch(s.cardUrl)
        .set(LIVE_HEADER, gone)
        .send({ title: 'After it closed' })
        .expect(200);

      await sees(s.caraLive, { type: 'card', cardId: s.card.id });
      expect(s.caraLive.signals[0]!.by).toBeNull();
    });

    // 34 (antagonist proof)
    it.each([
      ['text', 'Ana is leaving the company, see https://example.test'],
      ['a very long value', 'x'.repeat(2000)],
    ])(
      'never relays %s from X-Live-Connection to the room',
      async (_name, value) => {
        const s = await setUp();

        await s.cara.agent
          .patch(s.cardUrl)
          .set(LIVE_HEADER, value)
          .send({ title: 'Changed' })
          .expect(200);

        await sees(s.anaLive, { type: 'card', cardId: s.card.id });
        expect(s.anaLive.signals.map((signal) => signal.by)).toEqual([null]);
        expect(JSON.stringify(s.anaLive.signals)).not.toContain(
          value.slice(0, 20),
        );
      },
    );
  });

  describe('sessions that end (criterion 35)', () => {
    async function changePassword(cookie: string) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/password')
        .set('Cookie', cookie)
        .send({
          currentPassword: testPassword,
          newPassword: 'a new long password',
        })
        .expect(204);
      return response.headers['set-cookie'] as unknown as string[] | undefined;
    }

    // 35 (antagonist proof)
    it('closes the live connections of the sessions a password change ended', async () => {
      await setUp();
      const otherSession = await connect(app, await signInCookie(app, 'ana'));
      const changing = await signInCookie(app, 'ana');
      const changingLive = await connect(app, changing);

      await changePassword(changing);

      await until(
        () => !otherSession.socket.connected && !changingLive.socket.connected,
        'the connections of the ended sessions to close',
      );
    }, 20_000);

    // 35
    it('keeps the connection of the new session the password change started', async () => {
      await setUp();
      const changing = await signInCookie(app, 'ana');

      const cookies = await changePassword(changing);
      const fresh = cookies!.map((c) => c.split(';')[0]).join('; ');
      const live = await connect(app, fresh);
      await quiet(500);

      expect(live.socket.connected).toBe(true);
    }, 20_000);

    // 35
    it('refuses join-board from a session that has expired, and closes its connection', async () => {
      const s = await setUp();
      const expiring = await connect(app, await signInCookie(app, 'ana'));
      await prisma.session.updateMany({
        where: { userId: s.ana.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const joined = await join(expiring, s.board.id).catch(() => false);

      expect(joined).toBe(false);
      await until(
        () => !expiring.socket.connected,
        'the expired session’s connection to close',
      );
    });
  });

  describe('deleting a card that moves its subtasks (criterion 36)', () => {
    // 36 (antagonist proof)
    it('signals the new parent’s board when a subtask moves under a card on another board', async () => {
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
      const newParent = (
        await s.ana.agent
          .post(`/api/columns/${ideas.id}/cards`)
          .send({ title: 'New parent' })
          .expect(201)
      ).body as { id: string };
      const subtask = (
        await s.ana.agent
          .post(`${s.cardUrl}/subtasks`)
          .send({ columnId: s.toDo.id, title: 'Child' })
          .expect(201)
      ).body as { id: string };
      const backlogLive = await connect(app, cookieOf(s.cara.agent));
      expect(await join(backlogLive, backlog.id)).toBe(true);

      await s.ana.agent
        .delete(s.cardUrl)
        .send({
          subtasks: {
            [subtask.id]: { action: 'move', parentId: newParent.id },
          },
        })
        .expect(204);

      const moved = await prisma.card.findUniqueOrThrow({
        where: { id: subtask.id },
      });
      expect(moved.parentId).toBe(newParent.id);
      await sees(backlogLive, {
        type: 'card',
        boardId: backlog.id,
        cardId: newParent.id,
      });
    });
  });

  describe('changing a column (criterion 42)', () => {
    // 42
    it('sends a board signal to the board’s members when a column’s done flag changes', async () => {
      const s = await setUp();

      await s.ana.agent
        .patch(`/api/columns/${s.inProgress.id}`)
        .set(LIVE_HEADER, s.anaLive.id)
        .send({ isDone: true })
        .expect(200);

      await sees(s.caraLive, {
        type: 'board',
        boardId: s.board.id,
        by: s.anaLive.id,
      });
    });

    // 42
    it('sends nothing when the change is refused', async () => {
      const s = await setUp();

      await s.ana.agent
        .patch('/api/columns/00000000-0000-4000-8000-000000000000')
        .send({ isDone: true })
        .expect(404);
      await s.ana.agent.patch(s.cardUrl).send({ title: 'Fine' }).expect(200);

      await sees(s.caraLive, { type: 'card', cardId: s.card.id });
      expect(s.caraLive.signals.map((signal) => signal.type)).toEqual(['card']);
    });
  });
});
