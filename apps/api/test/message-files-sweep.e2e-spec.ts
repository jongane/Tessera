import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { vi } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  type FileJson,
  messageFileScenario,
  upload,
} from './support/files-scenario.js';
import { startLiveApp } from './support/live.js';
import { startTestApp } from './support/test-app.js';
import { emptyBucket, listKeys, testBucket } from './support/storage.js';

// Files on messages, PR B, criterion 9: the sweep of pending files older than
// 24 hours. It runs when the API starts and then every hour (the plan says
// "like live-sweep.ts"). Tested through the running API, so these tests name
// no class or function of the sweep: a file is made old by writing its
// created_at in the database, a second API is started to see the sweep at
// start, and the hourly run is seen by faking only setInterval.
const HOUR = 3_600_000;

describe('The sweep of pending files (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    expect(process.env['S3_BUCKET']).toBe(testBucket());
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
  });

  async function age(fileId: string, hours: number) {
    await prisma.$executeRaw`UPDATE files SET created_at = now() - make_interval(hours => ${hours}) WHERE id = ${fileId}::uuid`;
  }

  async function gone(fileId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files WHERE id = ${fileId}::uuid`;
    return Number(rows[0]!.n) === 0;
  }

  async function begin(fakeInterval: boolean) {
    if (fakeInterval) {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    }
    ({ app, prisma } = await startLiveApp());
    await resetDatabase(prisma);
    await emptyBucket();
    return messageFileScenario(app);
  }

  describe('when the API starts', () => {
    // 9
    it('deletes pending files older than 24 hours, row and object, and keeps younger ones, sent files and card files, however old', async () => {
      const { ana, cara, card, general, pend, sendWith } = await begin(false);
      const old = await pend(cara, general.id, 'old.pdf');
      const young = await pend(cara, general.id, 'young.pdf');
      const sentFile = await pend(cara, general.id, 'sent.pdf');
      await sendWith(cara, general.id, 'Sent', [sentFile.id]);
      const cardFile = (
        await upload(ana.agent, card.id, {
          filename: 'card.pdf',
          data: Buffer.from('card'),
        }).expect(201)
      ).body as FileJson;
      await age(old.id, 25);
      await age(young.id, 23);
      await age(sentFile.id, 72);
      await age(cardFile.id, 72);
      expect(await listKeys()).toHaveLength(4);

      // A second API on the same database and storage starts.
      const second = await startTestApp();
      try {
        const deadline = Date.now() + 5000;
        while (!(await gone(old.id)) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        await second.app.close();
      }

      expect(await gone(old.id)).toBe(true);
      expect(await gone(young.id)).toBe(false);
      expect(await gone(sentFile.id)).toBe(false);
      expect(await gone(cardFile.id)).toBe(false);
      expect(await listKeys()).toHaveLength(3);
    });
  });

  describe('every hour', () => {
    // 9
    it('deletes a pending file that has become older than 24 hours when the hour is up, and not one that has not', async () => {
      const { cara, general, pend } = await begin(true);
      const old = await pend(cara, general.id, 'old.pdf');
      const young = await pend(cara, general.id, 'young.pdf');
      await age(old.id, 25);
      await age(young.id, 22);

      await vi.advanceTimersByTimeAsync(HOUR);
      const deadline = Date.now() + 5000;
      while (!(await gone(old.id)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(await gone(old.id)).toBe(true);
      expect(await gone(young.id)).toBe(false);
      expect(await listKeys()).toHaveLength(1);
    });

    // 9
    it('leaves a file that is being sent as either sent or swept, never half of each', async () => {
      const { cara, general, pend } = await begin(true);
      for (let round = 0; round < 5; round++) {
        const file = await pend(cara, general.id, `race${round}.pdf`);
        await age(file.id, 25);

        const [sent] = await Promise.all([
          cara.agent
            .post(`/api/chats/${general.id}/messages`)
            .send({ body: `Race ${round}`, fileIds: [file.id] }),
          vi.advanceTimersByTimeAsync(HOUR),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const keys = await listKeys();
        const rows = await prisma.$queryRaw<
          { storage_key: string; message_id: string | null }[]
        >`SELECT storage_key, message_id FROM files WHERE id = ${file.id}::uuid`;
        if (sent.status === 201) {
          // Sent: the file is the message's, and its object is there.
          expect(rows).toHaveLength(1);
          expect(rows[0]!.message_id).toBe(sent.body.id);
          expect(keys).toContain(rows[0]!.storage_key);
          expect(sent.body.files).toHaveLength(1);
        } else {
          // Swept: no message, no row, no object left of it.
          expect(sent.status).toBe(400);
          expect(rows).toEqual([]);
          const messages = await cara.agent
            .get(`/api/chats/${general.id}/messages`)
            .expect(200);
          expect(
            messages.body.messages.map((m: { body: string }) => m.body),
          ).not.toContain(`Race ${round}`);
        }
        // Whatever happened, every object belongs to a row.
        const all = await prisma.$queryRaw<
          { storage_key: string }[]
        >`SELECT storage_key FROM files`;
        expect([...keys].sort()).toEqual(all.map((r) => r.storage_key).sort());
      }
    });
  });
});
