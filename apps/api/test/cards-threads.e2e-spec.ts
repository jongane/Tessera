import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { signedUpAs, startTestApp } from './support/test-app.js';

interface Column {
  id: string;
  name: string;
}

describe('Cards and threads (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await startTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  // Project WEB with board "Sprint 1" (To do, In progress, Done) and card
  // WEB-1 "Login" in To do. Ana is the admin; Ben is not a member.
  async function setUp() {
    const ana = await signedUpAs(app, 'ana');
    const ben = await signedUpAs(app, 'ben');
    const project = (
      await ana.agent
        .post('/api/projects')
        .send({ name: 'Website', code: 'WEB' })
    ).body as { id: string };
    const board = (
      await ana.agent
        .post(`/api/projects/${project.id}/boards`)
        .send({ name: 'Sprint 1' })
    ).body as { id: string };
    const [toDo, inProgress, done] = (
      await ana.agent.get(`/api/boards/${board.id}`)
    ).body.columns as Column[];
    const card = (
      await ana.agent
        .post(`/api/columns/${toDo!.id}/cards`)
        .send({ title: ' Login ', description: 'Email and password' })
        .expect(201)
    ).body as { id: string };
    return {
      ana,
      ben,
      project,
      board,
      toDo: toDo!,
      inProgress: inProgress!,
      done: done!,
      card,
      cardUrl: `/api/cards/${card.id}`,
    };
  }

  describe('cards', () => {
    it('creates a card with its number and its own thread', async () => {
      const { ana, card, cardUrl, toDo } = await setUp();

      const response = await ana.agent.get(cardUrl).expect(200);

      expect(response.body).toMatchObject({
        id: card.id,
        number: 'WEB-1',
        numberPath: '1',
        title: 'Login',
        description: 'Email and password',
        columnId: toDo.id,
        thread: { id: expect.any(String), title: 'Login' },
      });
    });

    it('finds a card by its number', async () => {
      const { ana, card } = await setUp();

      const response = await ana.agent
        .get('/api/cards/by-number/web-1')
        .expect(200);

      expect(response.body).toMatchObject({ id: card.id });
      await ana.agent.get('/api/cards/by-number/WEB-99').expect(404);
    });

    it('changes the title and description', async () => {
      const { ana, cardUrl } = await setUp();

      const response = await ana.agent
        .patch(cardUrl)
        .send({ title: 'Sign in', description: '' })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Sign in',
        description: null,
      });
    });

    it('refuses a blank or very long title', async () => {
      const { ana, toDo, cardUrl } = await setUp();

      await ana.agent
        .post(`/api/columns/${toDo.id}/cards`)
        .send({ title: '  ' })
        .expect(400);
      await ana.agent
        .patch(cardUrl)
        .send({ title: 'x'.repeat(201) })
        .expect(400);
    });

    it('moves a card, completing it in a done column and reopening it after', async () => {
      const { ana, cardUrl, done, toDo } = await setUp();

      await ana.agent
        .post(`${cardUrl}/move`)
        .send({ columnId: done.id })
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ isComplete: true }));
      await ana.agent
        .post(`${cardUrl}/move`)
        .send({ columnId: toDo.id })
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ isComplete: false }));
    });

    it('completes a card and offers the done column, then reopens it', async () => {
      const { ana, cardUrl, done } = await setUp();

      const completed = await ana.agent
        .post(`${cardUrl}/complete`)
        .send({})
        .expect(200);
      expect(completed.body).toMatchObject({
        card: { isComplete: true },
        doneColumnId: done.id,
      });

      await ana.agent
        .post(`${cardUrl}/reopen`)
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ isComplete: false }));
    });

    it('deletes a card, keeping its thread unlinked', async () => {
      const { ana, board, cardUrl } = await setUp();

      await ana.agent.delete(cardUrl).expect(204);

      await ana.agent.get(cardUrl).expect(404);
      const threads = await ana.agent
        .get(`/api/boards/${board.id}/threads`)
        .expect(200);
      expect(
        threads.body.map((t: { title: string; cardId: string | null }) => [
          t.title,
          t.cardId,
        ]),
      ).toEqual([
        ['General', null],
        ['Login', null],
      ]);
    });

    it('hides cards from people who are not members', async () => {
      const { ben, cardUrl, toDo, inProgress } = await setUp();

      await ben.agent.get(cardUrl).expect(404);
      await ben.agent.get('/api/cards/by-number/WEB-1').expect(404);
      await ben.agent.patch(cardUrl).send({ title: 'Mine' }).expect(404);
      await ben.agent
        .post(`${cardUrl}/move`)
        .send({ columnId: inProgress.id })
        .expect(404);
      await ben.agent.post(`${cardUrl}/complete`).send({}).expect(404);
      await ben.agent.post(`${cardUrl}/reopen`).expect(404);
      await ben.agent.delete(cardUrl).expect(404);
      await ben.agent
        .post(`/api/columns/${toDo.id}/cards`)
        .send({ title: 'Mine' })
        .expect(404);
    });
  });

  describe('threads', () => {
    it('lists a board’s threads, the general one first', async () => {
      const { ana, board } = await setUp();

      const response = await ana.agent
        .get(`/api/boards/${board.id}/threads`)
        .expect(200);

      expect(
        response.body.map((t: { kind: string; title: string }) => [
          t.kind,
          t.title,
        ]),
      ).toEqual([
        ['GENERAL', 'General'],
        ['TOPIC', 'Login'],
      ]);
    });

    it('creates a thread on its own, then links and unlinks a card', async () => {
      const { ana, board, toDo } = await setUp();
      const thread = (
        await ana.agent
          .post(`/api/boards/${board.id}/threads`)
          .send({ title: 'Release plan' })
          .expect(201)
      ).body as { id: string; cardId: string | null };
      expect(thread.cardId).toBeNull();
      const card = (
        await ana.agent
          .post(`/api/columns/${toDo.id}/cards`)
          .send({ title: 'Release' })
      ).body as { id: string; thread: { id: string } };
      // A new card has its own thread; unlink it to make room.
      const cardThread = (await ana.agent.get(`/api/cards/${card.id}`)).body
        .thread as { id: string };
      await ana.agent.delete(`/api/threads/${cardThread.id}/card`).expect(200);

      await ana.agent
        .put(`/api/threads/${thread.id}/card`)
        .send({ cardId: card.id })
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ cardId: card.id }));
      await ana.agent
        .delete(`/api/threads/${thread.id}/card`)
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ cardId: null }));
    });

    it('refuses linking a card that already has a thread', async () => {
      const { ana, board, card } = await setUp();
      const thread = (
        await ana.agent
          .post(`/api/boards/${board.id}/threads`)
          .send({ title: 'Release plan' })
      ).body as { id: string };

      await ana.agent
        .put(`/api/threads/${thread.id}/card`)
        .send({ cardId: card.id })
        .expect(409);
    });

    it('hides threads from people who are not members', async () => {
      const { ben, board } = await setUp();

      await ben.agent.get(`/api/boards/${board.id}/threads`).expect(404);
      await ben.agent
        .post(`/api/boards/${board.id}/threads`)
        .send({ title: 'Mine' })
        .expect(404);
    });
  });
});
