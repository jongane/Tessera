import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { fileScenario, upload } from './support/files-scenario.js';
import { closeAllSockets, cookieOf, startLiveApp } from './support/live.js';
import { multipart } from './support/multipart.js';
import { emptyBucket, listKeys } from './support/storage.js';

// Antagonist proof tests for files on cards (PR A): races and odd requests
// the main file tests do not cover.
const byNumber = (a: number, b: number) => a - b;

describe('Files on cards, attacks (e2e)', () => {
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

  // Waits until `n` database sessions are waiting for a row lock.
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

  // Holds the cards' rows locked while `during` starts requests, then lets
  // them go, so the requests run in a known order.
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

  it('removes a file even when its card is deleted at the same moment with moveFilesTo, and the history line goes to the card that took the files', async () => {
    const { ana, card, newCard } = await fileScenario(app);
    const target = await newCard('Target');
    const file = (
      await upload(ana.agent, card.id, {
        filename: 'plan.pdf',
        data: 'plan',
      }).expect(201)
    ).body as { id: string };

    let deleteCard!: Promise<{ status: number }>;
    let removeFile!: Promise<{ status: number; body: unknown }>;
    await holdingCards([card.id], async () => {
      // The card delete queues first, then the remove.
      deleteCard = ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
        .then((r) => r);
      await waitersOnLocks(1);
      removeFile = ana.agent.delete(`/api/files/${file.id}`).then((r) => r);
      await waitersOnLocks(2);
    });

    expect((await deleteCard).status).toBe(204);
    const removed = await removeFile;
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);
    expect(await prisma.file.count({ where: { id: file.id } })).toBe(0);
    expect(await listKeys()).toEqual([]);
    const activity = await ana.agent.get(`/api/cards/${target.id}/activity`);
    const kinds = (activity.body.items as { kind: string }[]).map(
      (line) => line.kind,
    );
    expect(kinds).toContain('FILE_REMOVED');
  });

  it('answers 404 Card not found to one of two cards deleted at once, each giving its files to the other, and loses no file', async () => {
    const { ana, card, newCard } = await fileScenario(app);
    const other = await newCard('Other');
    await upload(ana.agent, card.id, { filename: 'a.pdf', data: 'a' }).expect(
      201,
    );
    await upload(ana.agent, other.id, { filename: 'b.pdf', data: 'b' }).expect(
      201,
    );

    let first!: Promise<{ status: number; body: unknown }>;
    let second!: Promise<{ status: number; body: unknown }>;
    await holdingCards([card.id, other.id], async () => {
      first = ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${other.id}`)
        .then((r) => r);
      second = ana.agent
        .delete(`/api/cards/${other.id}?moveFilesTo=${card.id}`)
        .then((r) => r);
      await waitersOnLocks(2);
    });

    const answers = [await first, await second] as {
      status: number;
      body: { message?: string };
    }[];
    const statuses = answers.map((a) => a.status).sort(byNumber);
    expect(statuses, JSON.stringify(answers.map((a) => a.body))).toEqual([
      204, 404,
    ]);
    expect(answers.find((a) => a.status === 404)!.body.message).toBe(
      'Card not found',
    );
    // The survivor holds both files, and both stored objects are still there.
    expect(await prisma.file.count()).toBe(2);
    expect(await listKeys()).toHaveLength(2);
  });

  it('answers 404, never 500, when a subtask chosen for deletion is deleted at the same moment', async () => {
    const { ana, card, newSubtask } = await fileScenario(app);
    const sub = await newSubtask(card.id, 'Sub');

    let deleteSub!: Promise<{ status: number; body: unknown }>;
    let deleteParent!: Promise<{ status: number; body: unknown }>;
    await holdingCards([sub.id], async () => {
      // The subtask delete queues first, then the parent's.
      deleteSub = ana.agent.delete(`/api/cards/${sub.id}`).then((r) => r);
      await waitersOnLocks(1);
      deleteParent = ana.agent
        .delete(`/api/cards/${card.id}`)
        .send({ subtasks: { [sub.id]: { action: 'delete' } } })
        .then((r) => r);
      await waitersOnLocks(2);
    });

    const subAnswer = await deleteSub;
    const parentAnswer = await deleteParent;
    expect(subAnswer.status, JSON.stringify(subAnswer.body)).toBe(204);
    expect(parentAnswer.status, JSON.stringify(parentAnswer.body)).toBe(404);
  });

  it('answers a form sent as application/x-www-form-urlencoded instead of hanging', async () => {
    const { ana, card } = await fileScenario(app);

    const response = await ana.agent
      .post(`/api/cards/${card.id}/files`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('file=hello')
      .timeout(5000)
      .then(
        (r) => ({ status: r.status }),
        (error: Error) => ({ status: 0, error: error.message }),
      );

    expect(response).toEqual({ status: 400 });
  }, 15_000);

  it('answers 404 Card not found, and keeps nothing, for someone removed from the project during the upload', async () => {
    const { ana, cara, card, project } = await fileScenario(app);
    const { port } = (
      app.getHttpServer() as unknown as Server
    ).address() as AddressInfo;
    const { body, contentType } = multipart([
      { field: 'file', filename: 'late.pdf', data: Buffer.alloc(256 * 1024) },
    ]);

    const answer = new Promise<{ status: number; text: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/api/cards/${card.id}/files`,
            headers: {
              'Content-Type': contentType,
              'Transfer-Encoding': 'chunked',
              Cookie: cookieOf(cara.agent),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (c: Buffer) => chunks.push(c));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                text: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.on('error', reject);
        // Half the upload, then Cara is removed, then the rest.
        req.write(body.subarray(0, body.length / 2));
        setTimeout(() => {
          void ana.agent
            .delete(`/api/projects/${project.id}/members/${cara.user.id}`)
            .expect(204)
            .then(() => req.end(body.subarray(body.length / 2)), reject);
        }, 500);
      },
    );

    const { status, text } = await answer;
    expect(status, text).toBe(404);
    expect(JSON.parse(text).message).toBe('Card not found');
    expect(
      (await ana.agent.get(`/api/cards/${card.id}/activity`)).body.items.filter(
        (l: { kind: string }) => l.kind === 'FILE_ADDED',
      ),
    ).toEqual([]);
    expect(await prisma.file.count()).toBe(0);
    expect(await listKeys()).toEqual([]);
  });
});
