import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import { resetDatabase } from './support/reset-database.js';
import { signedUpAs, startTestApp } from './support/test-app.js';

describe('Projects and boards (e2e)', () => {
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

  // Ana creates project WEB with board "Sprint 1". Ben has an account but
  // is not a member.
  async function setUp() {
    const ana = await signedUpAs(app, 'ana');
    const ben = await signedUpAs(app, 'ben');
    const project = (
      await ana.agent
        .post('/api/projects')
        .send({ name: 'Website', code: 'web' })
        .expect(201)
    ).body as { id: string };
    const board = (
      await ana.agent
        .post(`/api/projects/${project.id}/boards`)
        .send({ name: 'Sprint 1' })
        .expect(201)
    ).body as { id: string };
    return { ana, ben, project, board };
  }

  describe('projects', () => {
    it('creates a project with its creator as admin, and lists it', async () => {
      const { ana, project } = await setUp();

      const list = await ana.agent.get('/api/projects').expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({
          id: project.id,
          name: 'Website',
          code: 'WEB',
        }),
      ]);
      await ana.agent.get(`/api/projects/${project.id}`).expect(200);
      await ana.agent.get('/api/projects/by-code/web').expect(200);
      const members = await ana.agent
        .get(`/api/projects/${project.id}/members`)
        .expect(200);
      expect(members.body).toEqual([
        expect.objectContaining({ displayName: 'ana', role: 'ADMIN' }),
      ]);
    });

    it('suggests a free code for a project name', async () => {
      const { ana } = await setUp();

      const response = await ana.agent
        .get('/api/projects/suggest-code')
        .query({ name: 'Web shop' })
        .expect(200);

      expect(response.body).toEqual({ code: expect.any(String) });
      expect(response.body.code).not.toBe('WEB');
    });

    it('refuses a code already in use, and bad input', async () => {
      const { ana } = await setUp();

      await ana.agent
        .post('/api/projects')
        .send({ name: 'Other', code: 'WEB' })
        .expect(409);
      await ana.agent
        .post('/api/projects')
        .send({ name: ' ', code: 'ABC' })
        .expect(400);
      await ana.agent
        .post('/api/projects')
        .send({ name: 'Other', code: 'ABC', extra: 1 })
        .expect(400);
    });

    it('lets an admin change the code and time zone', async () => {
      const { ana, project } = await setUp();

      const response = await ana.agent
        .patch(`/api/projects/${project.id}`)
        .send({ code: 'SITE', timeZone: 'Europe/London' })
        .expect(200);

      expect(response.body).toMatchObject({
        code: 'SITE',
        timeZone: 'Europe/London',
      });
      await ana.agent
        .patch(`/api/projects/${project.id}`)
        .send({ timeZone: 'Mars/Olympus' })
        .expect(400);
    });

    it('hides projects from people who are not members', async () => {
      const { ben, project } = await setUp();

      await expect(
        ben.agent.get('/api/projects').expect(200),
      ).resolves.toMatchObject({ body: [] });
      await ben.agent.get(`/api/projects/${project.id}`).expect(404);
      await ben.agent.get('/api/projects/by-code/WEB').expect(404);
      await ben.agent
        .patch(`/api/projects/${project.id}`)
        .send({ code: 'MINE' })
        .expect(404);
      await ben.agent.get(`/api/projects/${project.id}/boards`).expect(404);
      await ben.agent
        .post(`/api/projects/${project.id}/boards`)
        .send({ name: 'Mine' })
        .expect(404);
    });
  });

  describe('boards', () => {
    it('lists a project’s boards', async () => {
      const { ana, project, board } = await setUp();

      const response = await ana.agent
        .get(`/api/projects/${project.id}/boards`)
        .expect(200);

      expect(response.body).toEqual([
        expect.objectContaining({ id: board.id, name: 'Sprint 1' }),
      ]);
    });

    it('shows a board with its columns in order and their cards', async () => {
      const { ana, board } = await setUp();
      const columns = (await ana.agent.get(`/api/boards/${board.id}`)).body
        .columns as { id: string }[];
      for (const title of ['Login', 'Sign-up']) {
        await ana.agent
          .post(`/api/columns/${columns[0]!.id}/cards`)
          .send({ title })
          .expect(201);
      }

      const response = await ana.agent
        .get(`/api/boards/${board.id}`)
        .expect(200);

      expect(response.body).toMatchObject({ id: board.id, name: 'Sprint 1' });
      expect(
        response.body.columns.map(
          (c: {
            name: string;
            isDone: boolean;
            cards: { title: string }[];
          }) => [c.name, c.isDone, c.cards.map((card) => card.title)],
        ),
      ).toEqual([
        ['To do', false, ['Login', 'Sign-up']],
        ['In progress', false, []],
        ['Done', true, []],
      ]);
    });

    it('gives each card what the board shows on it', async () => {
      const { ana, cara, project, board, toDo, done, card, cardUrl } =
        await boardScenario(app);
      const frontend = (
        await ana.agent
          .post(`/api/projects/${project.id}/labels`)
          .send({ name: 'Frontend', colour: 'BLUE' })
      ).body as { id: string };
      const backend = (
        await ana.agent
          .post(`/api/projects/${project.id}/labels`)
          .send({ name: 'Backend', colour: 'GREEN' })
      ).body as { id: string };
      await ana.agent.put(`${cardUrl}/labels/${frontend.id}`).expect(204);
      await ana.agent.put(`${cardUrl}/labels/${backend.id}`).expect(204);
      await ana.agent.put(`${cardUrl}/assignees/${cara.user.id}`).expect(200);
      await ana.agent.put(`${cardUrl}/assignees/${ana.user.id}`).expect(200);
      const checklist = (
        await ana.agent.post(`${cardUrl}/checklists`).send({ name: 'Browsers' })
      ).body as { id: string };
      for (const text of ['Chrome', 'Safari', 'Firefox']) {
        const item = (
          await ana.agent
            .post(`/api/checklists/${checklist.id}/items`)
            .send({ text })
        ).body as { id: string };
        if (text === 'Chrome') {
          await ana.agent
            .patch(`/api/checklist-items/${item.id}`)
            .send({ isDone: true })
            .expect(200);
        }
      }
      const form = (
        await ana.agent
          .post(`${cardUrl}/subtasks`)
          .send({ title: 'Form', columnId: toDo.id })
      ).body as { id: string };
      await ana.agent
        .post(`${cardUrl}/subtasks`)
        .send({ title: 'Errors', columnId: toDo.id })
        .expect(201);
      await ana.agent
        .post(`/api/cards/${form.id}/move`)
        .send({ columnId: done.id })
        .expect(200);

      const response = await ana.agent
        .get(`/api/boards/${board.id}`)
        .expect(200);

      const login = response.body.columns[0].cards.find(
        (c: { id: string }) => c.id === card.id,
      );
      expect(login).toMatchObject({
        number: 'WEB-1',
        title: 'Login',
        labels: [
          { id: backend.id, name: 'Backend', colour: 'GREEN' },
          { id: frontend.id, name: 'Frontend', colour: 'BLUE' },
        ],
        assignees: [
          { id: cara.user.id, displayName: 'cara', isOwner: true },
          { id: ana.user.id, displayName: 'ana', isOwner: false },
        ],
        checklistProgress: { done: 1, total: 3 },
        subtaskProgress: { complete: 1, total: 2 },
      });
      expect(login.threadId).toEqual(expect.any(String));
      const formOnBoard = response.body.columns[2].cards[0];
      expect(formOnBoard).toMatchObject({
        number: 'WEB-1.1',
        labels: [],
        assignees: [],
        checklistProgress: { done: 0, total: 0 },
        subtaskProgress: { complete: 0, total: 0 },
      });
    });

    it('lets members mark which columns are done', async () => {
      const { ana, board } = await setUp();
      const columns = (await ana.agent.get(`/api/boards/${board.id}`)).body
        .columns as { id: string }[];

      await ana.agent
        .patch(`/api/columns/${columns[1]!.id}`)
        .send({ isDone: true })
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ isDone: true }));
    });

    it('hides boards and columns from people who are not members', async () => {
      const { ana, ben, board } = await setUp();
      const columns = (await ana.agent.get(`/api/boards/${board.id}`)).body
        .columns as { id: string }[];

      await ben.agent.get(`/api/boards/${board.id}`).expect(404);
      await ben.agent
        .patch(`/api/columns/${columns[0]!.id}`)
        .send({ isDone: true })
        .expect(404);
    });
  });
});
