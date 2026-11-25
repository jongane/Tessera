import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  type FileJson,
  messageFileScenario,
  upload,
} from './support/files-scenario.js';
import { startLiveApp, quiet } from './support/live.js';
import { emptyBucket, testBucket } from './support/storage.js';

// Files on messages, PR B, "Round 1 follow-ups" 3: GET /api/chats/:chatId/files
// answers the caller's own pending files in that chat, oldest first, as
// `{ files: FileInfo[] }` (the same shape as GET /api/cards/:cardId/files), so
// the message box can show leftovers after a reload.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('The caller’s pending files of a chat (e2e)', () => {
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

  afterAll(async () => {
    await app.close();
  });

  it('lists only the caller’s own pending files of that chat, oldest first, as files', async () => {
    const { ana, cara, general, cardChat, pend } =
      await messageFileScenario(app);
    const first = await pend(cara, general.id, 'first.pdf');
    await quiet(20);
    const second = await pend(cara, general.id, 'second.pdf');
    await pend(cara, cardChat.id, 'other-chat.pdf');
    await pend(ana, general.id, 'anas.pdf');

    const response = await cara.agent
      .get(`/api/chats/${general.id}/files`)
      .expect(200);

    expect(response.body).toEqual({ files: [first, second] });
    expect((response.body.files as FileJson[]).every((f) => f.pending)).toBe(
      true,
    );
  });

  it('never lists sent files, nor a card’s files, nor removed ones', async () => {
    const { cara, card, general, pend, sendWith } =
      await messageFileScenario(app);
    const sent = await pend(cara, general.id, 'sent.pdf');
    await sendWith(cara, general.id, 'Sent', [sent.id]);
    await upload(cara.agent, card.id, {
      filename: 'card.pdf',
      data: Buffer.from('card'),
    }).expect(201);
    const removed = await pend(cara, general.id, 'removed.pdf');
    await cara.agent.delete(`/api/files/${removed.id}`).expect(204);
    const left = await pend(cara, general.id, 'left.pdf');

    const response = await cara.agent
      .get(`/api/chats/${general.id}/files`)
      .expect(200);

    expect(response.body).toEqual({ files: [left] });
  });

  it('answers an empty list when there is nothing', async () => {
    const { cara, general } = await messageFileScenario(app);

    const response = await cara.agent
      .get(`/api/chats/${general.id}/files`)
      .expect(200);

    expect(response.body).toEqual({ files: [] });
  });

  it('gives a non-member and an unknown chat 404 "Chat not found"', async () => {
    const { ben, cara, general, pend } = await messageFileScenario(app);
    await pend(cara, general.id, 'secret.pdf');

    const outsider = await ben.agent
      .get(`/api/chats/${general.id}/files`)
      .expect(404);
    const unknown = await ben.agent
      .get(`/api/chats/${UNKNOWN_ID}/files`)
      .expect(404);

    expect(String(outsider.body.message)).toContain('Chat not found');
    expect(String(unknown.body.message)).toContain('Chat not found');
  });

  it('gives someone not signed in 401', async () => {
    const { general } = await messageFileScenario(app);

    await request(app.getHttpServer())
      .get(`/api/chats/${general.id}/files`)
      .expect(401);
  });
});
