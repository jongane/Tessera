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

// Files on messages, PR B (plan "files on messages, and screenshots in the
// message box", criteria 1 to 3): the files table after the migration
// add_message_files. Like file-rules.db-spec.ts, these write SQL straight
// into the database to prove it refuses bad data; each test first writes a
// good row, so a refusal is the rule's doing. A check refusal is 23514 and a
// foreign key refusal 23503. The project trigger (criterion 2) is told by
// its refusal only: the plan does not fix its message or its error code.
describe('Message file rules (database)', () => {
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

  const CHECK = /23514/;

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const { board, column } = await createBareBoard(prisma, project.id);
    const chat = await prisma.chat.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });
    const message = await prisma.message.create({
      data: { chatId: chat.id, authorId: ana.id, body: 'Hi' },
    });
    const card = await prisma.card.create({
      data: {
        title: 'Login page',
        boardId: board.id,
        columnId: column.id,
        projectId: project.id,
        numberPath: '1',
        position: 0,
      },
    });
    return { ana, project, board, chat, message, card };
  }

  interface Owner {
    cardId?: string | null;
    messageId?: string | null;
    pendingChatId?: string | null;
  }

  // Writes one row with the owner columns given (the others are null). A row
  // that does not name `pendingChatId` is written without that column, so the
  // tests of a message file fail for their own reason (no rule yet) and not
  // for the missing column.
  function insertFile(
    base: { projectId: string; uploaderId: string },
    owner: Owner,
    createdAt = new Date(),
  ) {
    if (owner.pendingChatId === undefined) {
      return prisma.$executeRaw`
        INSERT INTO files (id, project_id, card_id, message_id, uploader_id,
                           name, size, mime_type, storage_key, created_at)
        VALUES (${randomUUID()}::uuid, ${base.projectId}::uuid,
                ${owner.cardId ?? null}::uuid, ${owner.messageId ?? null}::uuid,
                ${base.uploaderId}::uuid, 'plan.pdf', 1234,
                'application/octet-stream', ${`files/${randomUUID()}`},
                ${createdAt}::timestamptz)`;
    }
    return prisma.$executeRaw`
      INSERT INTO files (id, project_id, card_id, message_id, pending_chat_id,
                         uploader_id, name, size, mime_type, storage_key,
                         created_at)
      VALUES (${randomUUID()}::uuid, ${base.projectId}::uuid,
              ${owner.cardId ?? null}::uuid, ${owner.messageId ?? null}::uuid,
              ${owner.pendingChatId}::uuid, ${base.uploaderId}::uuid,
              'plan.pdf', 1234, 'application/octet-stream',
              ${`files/${randomUUID()}`}, ${createdAt}::timestamptz)`;
  }

  async function fileCount(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  describe('who owns a file (criterion 1)', () => {
    // 1
    it('accepts a pending file: pending_chat_id set, no card, no message', async () => {
      const { ana, project, chat } = await setUp();

      await expect(
        insertFile(
          { projectId: project.id, uploaderId: ana.id },
          { pendingChatId: chat.id },
        ),
      ).resolves.toBe(1);
    });

    // 1
    it('still accepts a card file and a message file, with no pending chat', async () => {
      const { ana, project, card, message } = await setUp();
      const base = { projectId: project.id, uploaderId: ana.id };

      await expect(insertFile(base, { cardId: card.id })).resolves.toBe(1);
      await expect(insertFile(base, { messageId: message.id })).resolves.toBe(
        1,
      );
    });

    // 1
    it('refuses a file that is pending and also on a card', async () => {
      const { ana, project, chat, card } = await setUp();
      const base = { projectId: project.id, uploaderId: ana.id };
      await expect(insertFile(base, { pendingChatId: chat.id })).resolves.toBe(
        1,
      );

      await expect(
        insertFile(base, { pendingChatId: chat.id, cardId: card.id }),
      ).rejects.toThrow(CHECK);
    });

    // 1
    it('refuses a file that is pending and also on a message', async () => {
      const { ana, project, chat, message } = await setUp();
      const base = { projectId: project.id, uploaderId: ana.id };
      await expect(insertFile(base, { pendingChatId: chat.id })).resolves.toBe(
        1,
      );

      await expect(
        insertFile(base, { pendingChatId: chat.id, messageId: message.id }),
      ).rejects.toThrow(CHECK);
    });

    // 1
    it('refuses a file on a card and a message at once, and one with no owner at all', async () => {
      const { ana, project, chat, card, message } = await setUp();
      const base = { projectId: project.id, uploaderId: ana.id };
      await expect(insertFile(base, { pendingChatId: chat.id })).resolves.toBe(
        1,
      );

      await expect(
        insertFile(base, { cardId: card.id, messageId: message.id }),
      ).rejects.toThrow(CHECK);
      await expect(insertFile(base, {})).rejects.toThrow(CHECK);
      await expect(
        insertFile(base, {
          cardId: card.id,
          messageId: message.id,
          pendingChatId: chat.id,
        }),
      ).rejects.toThrow(CHECK);
    });

    // 1
    it('lets a pending file become a message file by setting message_id and clearing pending_chat_id in one update', async () => {
      const { ana, project, chat, message } = await setUp();
      await insertFile(
        { projectId: project.id, uploaderId: ana.id },
        { pendingChatId: chat.id },
      );

      await expect(
        prisma.$executeRaw`UPDATE files SET message_id = ${message.id}::uuid, pending_chat_id = NULL`,
      ).resolves.toBe(1);
      // Setting the message and keeping the pending chat is refused.
      await insertFile(
        { projectId: project.id, uploaderId: ana.id },
        { pendingChatId: chat.id },
      );
      await expect(
        prisma.$executeRaw`UPDATE files SET message_id = ${message.id}::uuid WHERE pending_chat_id IS NOT NULL`,
      ).rejects.toThrow(CHECK);
    });
  });

  describe('the project of a message file or a pending file (criterion 2)', () => {
    // 2
    it('accepts a message file and a pending file in their chat’s project', async () => {
      const { ana, project, chat, message } = await setUp();
      const base = { projectId: project.id, uploaderId: ana.id };

      await expect(insertFile(base, { messageId: message.id })).resolves.toBe(
        1,
      );
      await expect(insertFile(base, { pendingChatId: chat.id })).resolves.toBe(
        1,
      );
    });

    // 2
    it('refuses a message file whose project is not the project of the message’s board', async () => {
      const { ana, project, message } = await setUp();
      const other = await createProject(prisma, ana.id, 'Other', 'OTH');
      await expect(
        insertFile(
          { projectId: project.id, uploaderId: ana.id },
          { messageId: message.id },
        ),
      ).resolves.toBe(1);

      await expect(
        insertFile(
          { projectId: other.id, uploaderId: ana.id },
          { messageId: message.id },
        ),
      ).rejects.toThrow();
      await expect(fileCount()).resolves.toBe(1);
    });

    // 2
    it('refuses a pending file whose project is not the project of the chat’s board', async () => {
      const { ana, project, chat } = await setUp();
      const other = await createProject(prisma, ana.id, 'Other', 'OTH');
      await expect(
        insertFile(
          { projectId: project.id, uploaderId: ana.id },
          { pendingChatId: chat.id },
        ),
      ).resolves.toBe(1);

      await expect(
        insertFile(
          { projectId: other.id, uploaderId: ana.id },
          { pendingChatId: chat.id },
        ),
      ).rejects.toThrow();
      await expect(fileCount()).resolves.toBe(1);
    });

    // 2
    it('refuses to move a file to a message of another project by an update', async () => {
      const { ana, project, message } = await setUp();
      const other = await createProject(prisma, ana.id, 'Other', 'OTH');
      const otherBoard = await createBareBoard(prisma, other.id);
      const otherChat = await prisma.chat.create({
        data: { boardId: otherBoard.board.id, kind: 'GENERAL', title: 'G' },
      });
      const otherMessage = await prisma.message.create({
        data: { chatId: otherChat.id, authorId: ana.id, body: 'Elsewhere' },
      });
      await insertFile(
        { projectId: project.id, uploaderId: ana.id },
        { messageId: message.id },
      );

      await expect(
        prisma.$executeRaw`UPDATE files SET message_id = ${otherMessage.id}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('deleting what a file belongs to (criterion 3)', () => {
    // 3
    it('removes a chat’s pending file rows with the chat, and no one else’s', async () => {
      const { ana, project, board, chat } = await setUp();
      const otherChat = await prisma.chat.create({
        data: { boardId: board.id, kind: 'TOPIC', title: 'Release plan' },
      });
      const base = { projectId: project.id, uploaderId: ana.id };
      await insertFile(base, { pendingChatId: chat.id });
      await insertFile(base, { pendingChatId: chat.id });
      await insertFile(base, { pendingChatId: otherChat.id });
      await expect(fileCount()).resolves.toBe(3);

      await prisma.chat.delete({ where: { id: chat.id } });

      await expect(fileCount()).resolves.toBe(1);
    });

    // 3
    it('removes a message’s file rows with the message row, and no one else’s', async () => {
      const { ana, project, chat, message } = await setUp();
      const other = await prisma.message.create({
        data: { chatId: chat.id, authorId: ana.id, body: 'Other' },
      });
      const base = { projectId: project.id, uploaderId: ana.id };
      await insertFile(base, { messageId: message.id });
      await insertFile(base, { messageId: message.id });
      await insertFile(base, { messageId: other.id });
      await expect(fileCount()).resolves.toBe(3);

      await prisma.message.delete({ where: { id: message.id } });

      await expect(fileCount()).resolves.toBe(1);
    });

    // 3
    it('removes the message files of a chat when the chat is deleted', async () => {
      const { ana, project, chat, message } = await setUp();
      await insertFile(
        { projectId: project.id, uploaderId: ana.id },
        { messageId: message.id },
      );

      await prisma.chat.delete({ where: { id: chat.id } });

      await expect(fileCount()).resolves.toBe(0);
    });
  });
});
