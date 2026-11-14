import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  fileScenario,
  part,
  upload,
  uploadChunked,
  uploadParts,
} from './support/files-scenario.js';
import { startLiveApp } from './support/live.js';
import { emptyBucket, listKeys, testBucket } from './support/storage.js';

// Files on cards, PR A: the size limit (acceptance criteria 4, 5 and 14),
// with the smallest limit there is, FILE_SIZE_LIMIT_MB=1 (1 MB is 1,048,576
// bytes).
const MB = 1_048_576;

describe('The file size limit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env['FILE_SIZE_LIMIT_MB'] = '1';
    expect(process.env['S3_BUCKET']).toBe(testBucket());
    ({ app, prisma } = await startLiveApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await emptyBucket();
  });

  afterAll(async () => {
    await app.close();
    delete process.env['FILE_SIZE_LIMIT_MB'];
  });

  async function nothingKept(
    ana: { agent: { get: (url: string) => request.Test } },
    cardId: string,
  ) {
    expect(await listKeys()).toEqual([]);
    const list = await ana.agent.get(`/api/cards/${cardId}/files`);
    expect(list.body.files).toEqual([]);
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    expect(Number(rows[0]!.n)).toBe(0);
  }

  // 4, 5
  it('is the setting in bytes in the server settings', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/server/settings')
      .expect(200);

    expect(response.body.fileSizeLimitBytes).toBe(MB);
  });

  // 14
  it('accepts a file exactly at the limit', async () => {
    const { ana, card } = await fileScenario(app);

    const response = await upload(ana.agent, card.id, {
      filename: 'exact.bin',
      data: Buffer.alloc(MB, 7),
    }).expect(201);

    expect(response.body.size).toBe(MB);
    expect(await listKeys()).toHaveLength(1);
  });

  // 14
  it('refuses a file one byte over the limit with 413 and keeps nothing', async () => {
    const { ana, card } = await fileScenario(app);

    const response = await upload(ana.agent, card.id, {
      filename: 'big.bin',
      data: Buffer.alloc(MB + 1, 7),
    }).expect(413);

    expect(String(response.body.message)).toContain(
      'Files can be at most 1 MB',
    );
    await nothingKept(ana, card.id);
  });

  // 14
  it('refuses a much bigger file with 413, whatever the browser announced', async () => {
    const { ana, card } = await fileScenario(app);

    const response = await upload(ana.agent, card.id, {
      filename: 'huge.bin',
      data: Buffer.alloc(5 * MB, 1),
    }).expect(413);

    expect(String(response.body.message)).toContain(
      'Files can be at most 1 MB',
    );
    await nothingKept(ana, card.id);
  });

  // 14
  it('refuses an upload that announces no size (chunked) once it passes the limit', async () => {
    const { ana, card } = await fileScenario(app);

    const answer = await uploadChunked(
      app,
      ana.agent,
      card.id,
      'chunked.bin',
      Buffer.alloc(MB + 4096, 3),
    );

    expect(answer.status).toBe(413);
    expect(answer.text).toContain('Files can be at most 1 MB');
    await nothingKept(ana, card.id);
  });

  // 14
  it('accepts an upload that announces no size when it is within the limit', async () => {
    const { ana, card } = await fileScenario(app);

    const answer = await uploadChunked(
      app,
      ana.agent,
      card.id,
      'chunked.bin',
      Buffer.alloc(MB - 100, 3),
    );

    expect(answer.status).toBe(201);
    expect(await listKeys()).toHaveLength(1);
  });

  // 14 (the early refusal counts the file, not the form around it)
  it('does not refuse a file at the limit because of the form’s own bytes', async () => {
    const { ana, card } = await fileScenario(app);

    await uploadParts(ana.agent, card.id, [
      part('a-name-that-is-fairly-long-for-a-file.bin', Buffer.alloc(MB, 9)),
    ]).expect(201);
  });

  // 14 (the check of who you are comes before the size)
  it('gives a non-member 404, not 413, for a file that is too big', async () => {
    const { ben, card } = await fileScenario(app);

    const response = await upload(ben.agent, card.id, {
      filename: 'big.bin',
      data: Buffer.alloc(MB + 1, 7),
    }).expect(404);

    expect(String(response.body.message)).toContain('Card not found');
    expect(await listKeys()).toEqual([]);
  });
});
