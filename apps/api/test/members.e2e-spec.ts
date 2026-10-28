import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createProject,
} from './support/factories.js';
import { signedUpAs, startTestApp } from './support/test-app.js';

describe('Project members (e2e)', () => {
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

  // Ana is the admin of project WEB. Ben has an account but is not a member.
  async function setUp() {
    const ana = await signedUpAs(app, 'ana');
    const ben = await signedUpAs(app, 'ben');
    const project = await createProject(prisma, ana.user.id, 'Website', 'WEB');
    const members = `/api/projects/${project.id}/members`;
    return { ana, ben, project, members };
  }

  it('lets an admin add someone by the email of their account', async () => {
    const { ana, ben, members } = await setUp();

    const added = await ana.agent
      .post(members)
      .send({ email: ' BEN@example.com ' })
      .expect(201);

    expect(added.body).toEqual({
      userId: ben.user.id,
      displayName: 'ben',
      email: 'ben@example.com',
      role: 'MEMBER',
      joinedAt: expect.any(String),
    });
    const list = await ben.agent.get(members).expect(200);
    expect(
      list.body.map((m: { displayName: string; role: string }) => [
        m.displayName,
        m.role,
      ]),
    ).toEqual([
      ['ana', 'ADMIN'],
      ['ben', 'MEMBER'],
    ]);
  });

  it('says when no account has the email, or the person is already a member', async () => {
    const { ana, members } = await setUp();

    await ana.agent
      .post(members)
      .send({ email: 'nobody@example.com' })
      .expect(404);
    await ana.agent
      .post(members)
      .send({ email: 'ana@example.com' })
      .expect(409);
  });

  it('lets only admins add people, change roles or remove others', async () => {
    const { ana, ben, members } = await setUp();
    const cara = await signedUpAs(app, 'cara');
    await ana.agent.post(members).send({ email: 'ben@example.com' });
    await ana.agent.post(members).send({ email: 'cara@example.com' });

    await ben.agent
      .post(members)
      .send({ email: 'dan@example.com' })
      .expect(403);
    await ben.agent
      .patch(`${members}/${cara.user.id}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    await ben.agent.delete(`${members}/${cara.user.id}`).expect(403);
  });

  it('hides the project from people who are not members', async () => {
    const { ben, members } = await setUp();

    await ben.agent.get(members).expect(404);
    await ben.agent
      .post(members)
      .send({ email: 'ben@example.com' })
      .expect(404);
  });

  it('needs a session', async () => {
    const { members } = await setUp();

    await request(app.getHttpServer()).get(members).expect(401);
  });

  it('changes roles, but always keeps at least one admin', async () => {
    const { ana, ben, members } = await setUp();
    await ana.agent.post(members).send({ email: 'ben@example.com' });

    await ana.agent
      .patch(`${members}/${ana.user.id}`)
      .send({ role: 'MEMBER' })
      .expect(409);
    await ana.agent
      .patch(`${members}/${ben.user.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
    await ana.agent
      .patch(`${members}/${ana.user.id}`)
      .send({ role: 'MEMBER' })
      .expect(200);

    await ana.agent
      .patch(`${members}/${ben.user.id}`)
      .send({ role: 'MEMBER' })
      .expect(403);
  });

  it('lets anyone leave, except the last admin', async () => {
    const { ana, ben, members } = await setUp();
    await ana.agent.post(members).send({ email: 'ben@example.com' });

    await ana.agent.delete(`${members}/${ana.user.id}`).expect(409);
    await ben.agent.delete(`${members}/${ben.user.id}`).expect(204);

    await ben.agent.get(members).expect(404);
  });

  it('lets an admin remove someone', async () => {
    const { ana, ben, members } = await setUp();
    await ana.agent.post(members).send({ email: 'ben@example.com' });

    await ana.agent.delete(`${members}/${ben.user.id}`).expect(204);
    await ana.agent.delete(`${members}/${ben.user.id}`).expect(404);
  });

  it('refuses bad input', async () => {
    const { ana, members } = await setUp();

    await ana.agent.post(members).send({ email: 'nope' }).expect(400);
    await ana.agent
      .post(members)
      .send({ email: 'ben@example.com', role: 'OWNER' })
      .expect(400);
    await ana.agent.get('/api/projects/not-a-uuid/members').expect(400);
  });

  it('stops and saves the timer of someone who leaves', async () => {
    const { ana, ben, project, members } = await setUp();
    await ana.agent.post(members).send({ email: 'ben@example.com' });
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    await prisma.runningTimer.create({
      data: {
        userId: ben.user.id,
        projectId: project.id,
        cardId: card.id,
        workDate: new Date('2026-10-28'),
        startedAt: new Date(Date.now() - 20 * 60_000),
      },
    });

    await ben.agent.delete(`${members}/${ben.user.id}`).expect(204);

    await expect(prisma.runningTimer.count()).resolves.toBe(0);
    await expect(
      prisma.timeEntry.findMany({ select: { userId: true, minutes: true } }),
    ).resolves.toEqual([{ userId: ben.user.id, minutes: 20 }]);
  });
});
