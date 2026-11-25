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

// Round 2 of files on messages (PR B), fix 5: moving a board to another project
// is refused while its chats hold message or pending files (the antagonist's
// proof). Moves that leave every file in its chat's project, or that move
// nothing that holds a file, still succeed: a message to another chat, a chat
// to another board, and a board to another project.
describe('Message file project rule: moving the board (database)', () => {
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

  it.each(['message', 'pending'] as const)(
    'refuses moving a board whose chat holds a %s file to another project',
    async (kind) => {
      const ana = await createUser(prisma, 'ana');
      const web = await createProject(prisma, ana.id, 'WEB', 'WEB');
      const ops = await createProject(prisma, ana.id, 'OPS', 'OPS');
      const { board } = await createBareBoard(prisma, web.id);
      const chat = await prisma.chat.create({
        data: { boardId: board.id, kind: 'TOPIC', title: 'Talk' },
      });
      const message = await prisma.message.create({
        data: { chatId: chat.id, authorId: ana.id, body: 'Hi' },
      });
      const owner =
        kind === 'message'
          ? { messageId: message.id, pendingChatId: null }
          : { messageId: null, pendingChatId: chat.id };
      await prisma.$executeRaw`
        INSERT INTO files (id, project_id, message_id, pending_chat_id,
                           uploader_id, name, size, mime_type, storage_key)
        VALUES (${randomUUID()}::uuid, ${web.id}::uuid,
                ${owner.messageId}::uuid, ${owner.pendingChatId}::uuid,
                ${ana.id}::uuid, 'plan.pdf', 1, 'application/octet-stream',
                ${`files/${randomUUID()}`})`;

      await expect(
        prisma.$executeRaw`UPDATE boards SET project_id = ${ops.id}::uuid
                           WHERE id = ${board.id}::uuid`,
      ).rejects.toThrow();
    },
  );

  async function world() {
    const ana = await createUser(prisma, 'ana');
    const web = await createProject(prisma, ana.id, 'WEB', 'WEB');
    const ops = await createProject(prisma, ana.id, 'OPS', 'OPS');
    const one = await createBareBoard(prisma, web.id, 'One');
    const two = await createBareBoard(prisma, web.id, 'Two');
    const elsewhere = await createBareBoard(prisma, ops.id, 'Elsewhere');
    const chat = await prisma.chat.create({
      data: { boardId: one.board.id, kind: 'TOPIC', title: 'Talk' },
    });
    const sameProjectChat = await prisma.chat.create({
      data: { boardId: two.board.id, kind: 'TOPIC', title: 'Other talk' },
    });
    const message = await prisma.message.create({
      data: { chatId: chat.id, authorId: ana.id, body: 'Hi' },
    });
    return {
      ana,
      web,
      one: one.board,
      two: two.board,
      elsewhere: elsewhere.board,
      chat,
      sameProjectChat,
      message,
    };
  }

  function messageFile(projectId: string, messageId: string, userId: string) {
    return prisma.$executeRaw`
      INSERT INTO files (id, project_id, message_id, uploader_id, name, size,
                         mime_type, storage_key)
      VALUES (${randomUUID()}::uuid, ${projectId}::uuid, ${messageId}::uuid,
              ${userId}::uuid, 'plan.pdf', 1, 'application/octet-stream',
              ${`files/${randomUUID()}`})`;
  }

  describe('moves that are allowed', () => {
    it('moves a message with a file to another chat of the same project', async () => {
      const w = await world();
      await messageFile(w.web.id, w.message.id, w.ana.id);

      await expect(
        prisma.$executeRaw`UPDATE messages SET chat_id = ${w.sameProjectChat.id}::uuid
                           WHERE id = ${w.message.id}::uuid`,
      ).resolves.toBe(1);
    });

    it('moves a message with no file to a chat of another project', async () => {
      const w = await world();
      const otherChat = await prisma.chat.create({
        data: { boardId: w.elsewhere.id, kind: 'TOPIC', title: 'Far' },
      });

      await expect(
        prisma.$executeRaw`UPDATE messages SET chat_id = ${otherChat.id}::uuid
                           WHERE id = ${w.message.id}::uuid`,
      ).resolves.toBe(1);
    });

    it('moves a chat with a file to another board of the same project', async () => {
      const w = await world();
      await messageFile(w.web.id, w.message.id, w.ana.id);

      await expect(
        prisma.$executeRaw`UPDATE chats SET board_id = ${w.two.id}::uuid
                           WHERE id = ${w.chat.id}::uuid`,
      ).resolves.toBe(1);
    });

    it('moves a chat with no file to a board of another project', async () => {
      const w = await world();

      await expect(
        prisma.$executeRaw`UPDATE chats SET board_id = ${w.elsewhere.id}::uuid
                           WHERE id = ${w.chat.id}::uuid`,
      ).resolves.toBe(1);
    });

    it('moves a board whose chats hold no file to another project', async () => {
      const w = await world();
      const ops = await prisma.project.findFirstOrThrow({
        where: { code: 'OPS' },
      });

      await expect(
        prisma.$executeRaw`UPDATE boards SET project_id = ${ops.id}::uuid
                           WHERE id = ${w.one.id}::uuid`,
      ).resolves.toBe(1);
    });
  });
});
