import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario, upload } from './support/files-scenario.js';
import {
  closeAllSockets,
  connect,
  cookieOf,
  join,
  quiet,
  startLiveApp,
} from './support/live.js';
import { emptyBucket, listKeys, testBucket } from './support/storage.js';

// Files on messages, PR B, "Round 2 fixes" 2: a chip in the message box
// removes a file through DELETE /api/chats/:chatId/files/:fileId, which only
// ever deletes the caller's own PENDING file of that chat. A file already sent
// is never deleted from here.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Removing a pending file from a chat (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
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

  async function fileRows(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  it('removes the caller’s own pending file: 204, row and object gone, no signal', async () => {
    const { ana, cara, board, general, pend } = await messageFileScenario(app);
    const file = await pend(cara, general.id, 'plan.pdf');
    const anaLive = await connect(app, cookieOf(ana.agent));
    expect(await join(anaLive, board.id)).toBe(true);

    await cara.agent
      .delete(`/api/chats/${general.id}/files/${file.id}`)
      .expect(204);
    await quiet();

    expect(await fileRows()).toBe(0);
    expect(await listKeys()).toEqual([]);
    expect(anaLive.signals).toEqual([]);
  });

  it('answers 409 "This file was already sent" for a sent file, and deletes nothing', async () => {
    const { cara, general, pend, sendWith } = await messageFileScenario(app);
    const file = await pend(cara, general.id, 'plan.pdf');
    await sendWith(cara, general.id, 'Sent', [file.id]);

    const response = await cara.agent
      .delete(`/api/chats/${general.id}/files/${file.id}`)
      .expect(409);

    expect(String(response.body.message)).toContain(
      'This file was already sent',
    );
    expect(await fileRows()).toBe(1);
    expect(await listKeys()).toHaveLength(1);
    await cara.agent.get(`/api/files/${file.id}/download`).expect(200);
  });

  it('answers 404 "File not found" for someone else’s pending file, an unknown id, a card’s file and a file of another chat, and deletes nothing', async () => {
    const { ana, cara, card, general, cardChat, pend } =
      await messageFileScenario(app);
    const anas = await pend(ana, general.id, 'anas.pdf');
    const elsewhere = await pend(cara, cardChat.id, 'elsewhere.pdf');
    const cardFile = (
      await upload(cara.agent, card.id, {
        filename: 'card.pdf',
        data: Buffer.from('card'),
      }).expect(201)
    ).body as { id: string };

    for (const id of [anas.id, UNKNOWN_ID, cardFile.id, elsewhere.id]) {
      const response = await cara.agent
        .delete(`/api/chats/${general.id}/files/${id}`)
        .expect(404);
      expect(String(response.body.message)).toContain('File not found');
    }

    expect(await fileRows()).toBe(3);
    expect(await listKeys()).toHaveLength(3);
  });

  it('answers 404 "Chat not found" to a non-member and for an unknown chat', async () => {
    const { ben, cara, general, pend } = await messageFileScenario(app);
    const file = await pend(cara, general.id, 'plan.pdf');

    const outsider = await ben.agent
      .delete(`/api/chats/${general.id}/files/${file.id}`)
      .expect(404);
    const unknown = await ben.agent
      .delete(`/api/chats/${UNKNOWN_ID}/files/${file.id}`)
      .expect(404);

    expect(String(outsider.body.message)).toContain('Chat not found');
    expect(String(unknown.body.message)).toContain('Chat not found');
    expect(await fileRows()).toBe(1);
  });

  it('answers 401 to someone not signed in', async () => {
    const { cara, general, pend } = await messageFileScenario(app);
    const file = await pend(cara, general.id, 'plan.pdf');

    await request(app.getHttpServer())
      .delete(`/api/chats/${general.id}/files/${file.id}`)
      .expect(401);

    expect(await fileRows()).toBe(1);
  });
});
