import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario } from './support/files-scenario.js';
import { closeAllSockets, startLiveApp } from './support/live.js';
import { emptyBucket, testBucket } from './support/storage.js';

// Antagonist proof tests for files on messages (PR B). Each one fails on the
// branch as it is.
describe('Files on messages: attacks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    delete process.env['FILE_SIZE_LIMIT_MB'];
    expect(process.env['S3_BUCKET']).toBe(testBucket());
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

  // Criterion 12: "Sending the same message again (same id, 'Try again')
  // after it was saved answers 200 with the saved message and its files."
  // A double submit (or a Try again while the first POST is still running)
  // with the same id and the same files: the second waits on the file locks,
  // then finds the files no longer pending and answers 400 "A file is no
  // longer there", although its message was saved. Without files the same
  // race answers 200 (the unique id is caught).
  it('answers both of two sends at once with the same id and files with the saved message, never 400', async () => {
    const { cara, general, pend } = await messageFileScenario(app);
    const files = await Promise.all(
      ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'].map((name) =>
        pend(cara, general.id, name),
      ),
    );
    const id = '7d1f3a52-5a1b-4c3e-9a7e-0b8c2d4e6f10';
    const send = () =>
      cara.agent.post(`/api/chats/${general.id}/messages`).send({
        id,
        body: 'Same message',
        fileIds: files.map((f) => f.id),
      });

    const answers = await Promise.all([send(), send(), send()]);

    expect(answers.map((a) => [a.status, a.body.message ?? a.body.id])).toEqual(
      [
        [expect.toSatisfy((s: number) => s === 200 || s === 201), id],
        [expect.toSatisfy((s: number) => s === 200 || s === 201), id],
        [expect.toSatisfy((s: number) => s === 200 || s === 201), id],
      ],
    );
    for (const answer of answers) {
      expect(answer.body.id).toBe(id);
      expect(answer.body.files).toHaveLength(5);
    }
  });
});
