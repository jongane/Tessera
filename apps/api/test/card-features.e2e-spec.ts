import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { boardScenario } from './support/board-scenario.js';
import { startTestApp } from './support/test-app.js';

describe('Card features (e2e)', () => {
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

  const setUp = () => boardScenario(app);

  describe('card fields', () => {
    it('sets priority, due date and estimate', async () => {
      const { ana, cardUrl } = await setUp();

      const response = await ana.agent
        .patch(cardUrl)
        .send({
          priority: 'HIGH',
          due: { date: '2026-11-02' },
          estimateMinutes: 90,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        priority: 'HIGH',
        dueAt: '2026-11-02T00:00:00.000Z',
        dueHasTime: false,
        estimateMinutes: 90,
      });
      await ana.agent
        .patch(cardUrl)
        .send({ due: { at: '2026-11-02T17:00:00+01:00' } })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            dueAt: '2026-11-02T16:00:00.000Z',
            dueHasTime: true,
          }),
        );
      await ana.agent
        .patch(cardUrl)
        .send({ due: null, estimateMinutes: null })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ dueAt: null, estimateMinutes: null }),
        );
    });

    it('refuses bad values before changing anything', async () => {
      const { ana, cardUrl } = await setUp();

      for (const bad of [
        { priority: 'SOON' },
        { due: { date: '2 November' } },
        { due: { at: '2026-11-02T17:00:00' } },
        { estimateMinutes: -5 },
        { estimateMinutes: 1.5 },
        { title: 'Sign in', priority: 'SOON' },
      ]) {
        await ana.agent.patch(cardUrl).send(bad).expect(400);
      }
      await ana.agent
        .get(cardUrl)
        .expect((r) => expect(r.body).toMatchObject({ title: 'Login' }));
    });
  });

  describe('subtasks', () => {
    it('adds subtasks, lists them with progress, and moves one to the top level', async () => {
      const { ana, cardUrl, toDo } = await setUp();

      const sub = (
        await ana.agent
          .post(`${cardUrl}/subtasks`)
          .send({ columnId: toDo.id, title: 'Form' })
          .expect(201)
      ).body as { id: string };
      const list = await ana.agent.get(`${cardUrl}/subtasks`).expect(200);
      expect(list.body).toEqual({
        subtasks: [expect.objectContaining({ id: sub.id, numberPath: '1.1' })],
        progress: { complete: 0, total: 1 },
      });

      await ana.agent
        .put(`/api/cards/${sub.id}/parent`)
        .send({ parentId: null })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ parentId: null, numberPath: '2' }),
        );
      await ana.agent
        .get('/api/cards/by-number/WEB-1.1')
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ id: sub.id }));
    });

    it('warns when a subtask is due after its parent', async () => {
      const { ana, cardUrl, toDo } = await setUp();
      const sub = (
        await ana.agent
          .post(`${cardUrl}/subtasks`)
          .send({ columnId: toDo.id, title: 'Form' })
      ).body as { id: string };
      await ana.agent.patch(cardUrl).send({ due: { date: '2026-11-02' } });
      await ana.agent
        .patch(`/api/cards/${sub.id}`)
        .send({ due: { date: '2026-11-03' } });

      await ana.agent
        .get(`/api/cards/${sub.id}/due-warnings`)
        .expect(200, { dueAfterParent: true, subtasksDueAfter: [] });
    });
  });

  describe('assignees', () => {
    it('assigns people, makes the first the owner, and changes the owner', async () => {
      const { ana, cara, cardUrl } = await setUp();

      await ana.agent.put(`${cardUrl}/assignees/${ana.user.id}`).expect(200);
      await ana.agent.put(`${cardUrl}/assignees/${cara.user.id}`).expect(200);
      await ana.agent
        .put(`${cardUrl}/owner`)
        .send({ userId: cara.user.id })
        .expect(200);
      await ana.agent.delete(`${cardUrl}/assignees/${ana.user.id}`).expect(200);

      const response = await ana.agent.get(`${cardUrl}/assignees`).expect(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          isOwner: true,
          user: { id: cara.user.id, displayName: 'cara' },
        }),
      ]);
    });

    it('only assigns project members', async () => {
      const { ana, ben, cardUrl } = await setUp();

      await ana.agent.put(`${cardUrl}/assignees/${ben.user.id}`).expect(400);
    });
  });

  describe('labels', () => {
    it('creates labels, puts them on cards, and lets only admins change them', async () => {
      const { ana, cara, project, cardUrl } = await setUp();
      const labels = `/api/projects/${project.id}/labels`;

      const bug = (
        await cara.agent
          .post(labels)
          .send({ name: 'Bug', colour: 'RED' })
          .expect(201)
      ).body as { id: string };
      await cara.agent.put(`${cardUrl}/labels/${bug.id}`).expect(204);
      await cara.agent
        .get(`${cardUrl}/labels`)
        .expect(200)
        .expect((r) =>
          expect(r.body).toEqual([expect.objectContaining({ name: 'Bug' })]),
        );

      await cara.agent
        .patch(`/api/labels/${bug.id}`)
        .send({ colour: 'BLUE' })
        .expect(403);
      await ana.agent
        .patch(`/api/labels/${bug.id}`)
        .send({ name: 'Defect', colour: 'BLUE' })
        .expect(200);
      await ana.agent
        .get(labels)
        .expect((r) =>
          expect(r.body).toEqual([
            expect.objectContaining({ name: 'Defect', colour: 'BLUE' }),
          ]),
        );
      await cara.agent.delete(`${cardUrl}/labels/${bug.id}`).expect(204);
      await ana.agent.delete(`/api/labels/${bug.id}`).expect(204);
    });

    it('refuses an unknown colour', async () => {
      const { ana, project } = await setUp();

      await ana.agent
        .post(`/api/projects/${project.id}/labels`)
        .send({ name: 'Bug', colour: 'MAUVE' })
        .expect(400);
    });
  });

  describe('time', () => {
    it('logs, edits and deletes time, and shows the totals', async () => {
      const { ana, cardUrl } = await setUp();
      await ana.agent.patch(cardUrl).send({ estimateMinutes: 120 });

      const entry = (
        await ana.agent
          .post(`${cardUrl}/time-entries`)
          .send({ minutes: 30, workDate: '2026-10-01', note: 'Tests' })
          .expect(201)
      ).body as { id: string };
      await ana.agent
        .patch(`/api/time-entries/${entry.id}`)
        .send({ minutes: 45, note: null })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ minutes: 45, note: null }),
        );
      await ana.agent.get(`${cardUrl}/time-entries`).expect((r) =>
        expect(r.body).toEqual([
          expect.objectContaining({
            minutes: 45,
            user: { id: ana.user.id, displayName: 'ana' },
          }),
        ]),
      );
      await ana.agent
        .get(`${cardUrl}/time-totals`)
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            estimateMinutes: 120,
            timeSpentMinutes: 45,
          }),
        );

      await ana.agent.delete(`/api/time-entries/${entry.id}`).expect(204);
    });

    it('refuses a bad entry', async () => {
      const { ana, cardUrl } = await setUp();

      for (const bad of [
        { minutes: 0, workDate: '2026-10-01' },
        { minutes: 1441, workDate: '2026-10-01' },
        { minutes: 30, workDate: '2999-01-01' },
        { minutes: 30, workDate: 'yesterday' },
      ]) {
        await ana.agent.post(`${cardUrl}/time-entries`).send(bad).expect(400);
      }
    });

    it('starts and stops a timer, asking before stopping one elsewhere', async () => {
      const { ana, cardUrl, toDo } = await setUp();
      const other = (
        await ana.agent
          .post(`/api/columns/${toDo.id}/cards`)
          .send({ title: 'Sign-up' })
      ).body as { id: string };

      await ana.agent
        .post(`${cardUrl}/timer`)
        .send({ timeZone: 'Europe/London' })
        .expect(201);
      await ana.agent
        .get('/api/timer')
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            timer: { cardId: expect.any(String) },
          }),
        );
      const refused = await ana.agent
        .post(`/api/cards/${other.id}/timer`)
        .send({})
        .expect(409);
      expect(refused.body.runningCardId).toBe(
        (await ana.agent.get('/api/timer')).body.timer.cardId,
      );
      await ana.agent
        .post(`/api/cards/${other.id}/timer`)
        .send({ stopRunning: true })
        .expect(201);

      await ana.agent.delete('/api/timer').expect(200);
      await ana.agent.get('/api/timer').expect(200, { timer: null });
      await ana.agent.delete('/api/timer').expect(404);
    });
  });

  describe('checklists', () => {
    it('makes checklists and items, ticks, reorders and turns an item into a subtask', async () => {
      const { ana, cardUrl } = await setUp();

      const list = (
        await ana.agent
          .post(`${cardUrl}/checklists`)
          .send({ name: 'Testing' })
          .expect(201)
      ).body as { id: string; suggestNewCard: boolean };
      expect(list.suggestNewCard).toBe(false);
      const items = [];
      for (const text of ['A', 'B', 'C']) {
        items.push(
          (
            await ana.agent
              .post(`/api/checklists/${list.id}/items`)
              .send({ text })
              .expect(201)
          ).body as { id: string },
        );
      }
      await ana.agent
        .patch(`/api/checklist-items/${items[0]!.id}`)
        .send({ isDone: true })
        .expect(200);
      await ana.agent
        .patch(`/api/checklist-items/${items[2]!.id}`)
        .send({ position: 0 })
        .expect(200);
      await ana.agent
        .post(`/api/checklist-items/${items[1]!.id}/subtask`)
        .expect(201)
        .expect((r) => expect(r.body).toMatchObject({ title: 'B' }));
      await ana.agent
        .patch(`/api/checklists/${list.id}`)
        .send({ name: 'QA' })
        .expect(204);

      const response = await ana.agent.get(`${cardUrl}/checklists`).expect(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          name: 'QA',
          progress: { done: 1, total: 2 },
          items: [
            expect.objectContaining({ text: 'C', isDone: false }),
            expect.objectContaining({ text: 'A', isDone: true }),
          ],
        }),
      ]);

      await ana.agent
        .delete(`/api/checklist-items/${items[0]!.id}`)
        .expect(204);
      await ana.agent.delete(`/api/checklists/${list.id}`).expect(204);
    });
  });

  describe('activity', () => {
    it('shows the card’s history, newest first, a page at a time', async () => {
      const { ana, cardUrl } = await setUp();
      await ana.agent.patch(cardUrl).send({ title: 'Sign in' });
      await ana.agent.patch(cardUrl).send({ priority: 'HIGH' });

      const first = await ana.agent
        .get(`${cardUrl}/activity`)
        .query({ limit: 2 })
        .expect(200);
      expect(first.body.items.map((l: { kind: string }) => l.kind)).toEqual([
        'PRIORITY_CHANGED',
        'TITLE_CHANGED',
      ]);
      const second = await ana.agent
        .get(`${cardUrl}/activity`)
        .query({ limit: 2, before: first.body.nextBefore })
        .expect(200);
      expect(second.body).toMatchObject({
        items: [expect.objectContaining({ kind: 'CREATED' })],
        nextBefore: null,
      });
      await ana.agent
        .get(`${cardUrl}/activity`)
        .query({ limit: 'many' })
        .expect(400);
    });
  });

  it('hides every card feature from people who are not members', async () => {
    const { ana, ben, project, cardUrl, toDo } = await setUp();
    const list = (
      await ana.agent.post(`${cardUrl}/checklists`).send({ name: 'Testing' })
    ).body as { id: string };
    const entry = (
      await ana.agent
        .post(`${cardUrl}/time-entries`)
        .send({ minutes: 30, workDate: '2026-10-01' })
    ).body as { id: string };

    for (const [method, url, body] of [
      ['get', `${cardUrl}/subtasks`],
      ['post', `${cardUrl}/subtasks`, { columnId: toDo.id, title: 'Mine' }],
      ['get', `${cardUrl}/due-warnings`],
      ['get', `${cardUrl}/assignees`],
      ['put', `${cardUrl}/assignees/${ben.user.id}`],
      ['get', `${cardUrl}/labels`],
      ['get', `/api/projects/${project.id}/labels`],
      ['get', `${cardUrl}/time-entries`],
      [
        'post',
        `${cardUrl}/time-entries`,
        { minutes: 5, workDate: '2026-10-01' },
      ],
      ['patch', `/api/time-entries/${entry.id}`, { minutes: 5 }],
      ['get', `${cardUrl}/time-totals`],
      ['post', `${cardUrl}/timer`, {}],
      ['get', `${cardUrl}/checklists`],
      ['post', `/api/checklists/${list.id}/items`, { text: 'Mine' }],
      ['get', `${cardUrl}/activity`],
    ] as const) {
      const request = ben.agent[method](url);
      await (body ? request.send(body) : request).expect(404);
    }
  });
});
