import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { signedUpAs } from './test-app.js';

interface Column {
  id: string;
  name: string;
}

// Through the API: Ana creates project WEB with board "Sprint 1" (To do,
// In progress, Done) and card WEB-1 "Login" in To do, and adds Cara as a
// member. Ben has an account but is not a member.
export async function boardScenario(app: INestApplication<App>) {
  const ana = await signedUpAs(app, 'ana');
  const ben = await signedUpAs(app, 'ben');
  const cara = await signedUpAs(app, 'cara');
  const project = (
    await ana.agent.post('/api/projects').send({ name: 'Website', code: 'WEB' })
  ).body as { id: string };
  await ana.agent
    .post(`/api/projects/${project.id}/members`)
    .send({ email: 'cara@example.com' })
    .expect(201);
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
      .send({ title: 'Login' })
      .expect(201)
  ).body as { id: string };
  return {
    ana,
    ben,
    cara,
    project,
    board,
    toDo: toDo!,
    inProgress: inProgress!,
    done: done!,
    card,
    cardUrl: `/api/cards/${card.id}`,
  };
}
