import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// Antagonist proof test for files on messages (PR B), criterion 2 and risk
// 13: "a row whose project_id differs from the project of the message's (or
// pending chat's) board is refused". The trigger files_in_chat_project only
// fires on INSERT or UPDATE of the files row. Moving the message (or a chat
// holding pending files) to a board of another project leaves the file
// pointing at the old project, and nothing refuses it.
describe('Message file project rule: moving what holds the file (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function chatIn(code: string, ownerId: string) {
    const project = await createProject(prisma, ownerId, code, code);
    const { board } = await createBareBoard(prisma, project.id);
    const chat = await prisma.chat.create({
      data: { boardId: board.id, kind: 'TOPIC', title: code },
    });
    return { project, board, chat };
  }

  it('refuses moving a message with a file into a chat of another project', async () => {
    const ana = await createUser(prisma, 'ana');
    const web = await chatIn('WEB', ana.id);
    const ops = await chatIn('OPS', ana.id);
    const message = await prisma.message.create({
      data: { chatId: web.chat.id, authorId: ana.id, body: 'Hi' },
    });
    await prisma.$executeRaw`
      INSERT INTO files (id, project_id, message_id, uploader_id, name, size,
                         mime_type, storage_key)
      VALUES (${randomUUID()}::uuid, ${web.project.id}::uuid,
              ${message.id}::uuid, ${ana.id}::uuid, 'plan.pdf', 1,
              'application/octet-stream', ${`files/${randomUUID()}`})`;

    await expect(
      prisma.$executeRaw`UPDATE messages SET chat_id = ${ops.chat.id}::uuid
                         WHERE id = ${message.id}::uuid`,
    ).rejects.toThrow();
  });

  // Moving a chat to a board of another project, while it holds message files
  // or pending files, has the same hole.
  it.each(['message', 'pending'] as const)(
    'refuses moving a chat that holds a %s file to a board of another project',
    async (kind) => {
      const ana = await createUser(prisma, 'ana');
      const web = await chatIn('WEB', ana.id);
      const ops = await chatIn('OPS', ana.id);
      const message = await prisma.message.create({
        data: { chatId: web.chat.id, authorId: ana.id, body: 'Hi' },
      });
      const owner =
        kind === 'message'
          ? { messageId: message.id, pendingChatId: null }
          : { messageId: null, pendingChatId: web.chat.id };
      await prisma.$executeRaw`
        INSERT INTO files (id, project_id, message_id, pending_chat_id,
                           uploader_id, name, size, mime_type, storage_key)
        VALUES (${randomUUID()}::uuid, ${web.project.id}::uuid,
                ${owner.messageId}::uuid, ${owner.pendingChatId}::uuid,
                ${ana.id}::uuid, 'plan.pdf', 1, 'application/octet-stream',
                ${`files/${randomUUID()}`})`;

      await expect(
        prisma.$executeRaw`UPDATE chats SET board_id = ${ops.board.id}::uuid
                           WHERE id = ${web.chat.id}::uuid`,
      ).rejects.toThrow();
    },
  );
});
