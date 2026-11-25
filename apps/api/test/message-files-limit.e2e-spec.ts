import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario, uploadToChat } from './support/files-scenario.js';
import { startLiveApp } from './support/live.js';
import { emptyBucket, listKeys, testBucket } from './support/storage.js';

// Files on messages, PR B: the size limit for a pending upload (criterion 5,
// 413 over the limit), with the smallest limit there is, FILE_SIZE_LIMIT_MB=1
// (1 MB is 1,048,576 bytes), as in files-limit.e2e-spec.ts.
const MB = 1_048_576;

describe('The file size limit for the message box (e2e)', () => {
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

  // 5
  it('accepts a pending file exactly at the limit', async () => {
    const { ana, general } = await messageFileScenario(app);

    const response = await uploadToChat(ana.agent, general.id, {
      filename: 'exact.bin',
      data: Buffer.alloc(MB, 7),
    }).expect(201);

    expect(response.body.size).toBe(MB);
    expect(await listKeys()).toHaveLength(1);
  });

  // 5
  it('refuses a file one byte over the limit with 413 and keeps nothing', async () => {
    const { ana, general } = await messageFileScenario(app);

    await uploadToChat(ana.agent, general.id, {
      filename: 'big.bin',
      data: Buffer.alloc(MB + 1, 7),
    }).expect(413);

    expect(await listKeys()).toEqual([]);
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
