import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario } from './support/files-scenario.js';
import { quiet, startLiveApp } from './support/live.js';
import { emptyBucket, testBucket } from './support/storage.js';

// Antagonist proof test, round 3: DELETE /api/chats/:chatId/files/:fileId
// racing a send of the same file. Plan "Round 2 fixes" 2: "a file already
// sent answers 409 'This file was already sent'". The route locks the file
// row with FOR UPDATE OF f over a LEFT JOIN of messages; when the send commits
// first, PostgreSQL re-reads the locked file row but not the joined message
// row, so message_chat_id stays NULL and the route answers 404.
describe('Removing a pending file while it is being sent (e2e)', () => {
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

  it('answers 409 "This file was already sent" when the send commits first', async () => {
    const { cara, general, pend } = await messageFileScenario(app);
    const file = await pend(cara, general.id, 'plan.pdf');

    let removal: Promise<{ status: number; body: { message?: unknown } }>;
    // What sendMessage does, held open while the chip's Remove arrives.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM files WHERE id = ${file.id}::uuid FOR UPDATE`;
        const message = await tx.message.create({
          data: {
            chatId: general.id,
            authorId: file.uploader!.id,
            body: 'Sent',
          },
        });
        await tx.file.update({
          where: { id: file.id },
          data: { messageId: message.id, pendingChatId: null },
        });
        removal = cara.agent
          .delete(`/api/chats/${general.id}/files/${file.id}`)
          .then((r) => r);
        await quiet(300);
      },
      { timeout: 10_000 },
    );
    const response = await removal!;

    expect(response.status).toBe(409);
    expect(String(response.body.message)).toContain(
      'This file was already sent',
    );
    const left = await prisma.file.findUnique({ where: { id: file.id } });
    expect(left?.messageId).not.toBeNull();
  });
});
