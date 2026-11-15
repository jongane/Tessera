import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// The files table (files on cards, PR A, acceptance criteria 7 to 11 and
// the database part of 32; docs/data-model.md, File). Like
// time-rules.db-spec.ts, these write to the database directly to prove it
// refuses bad data. The rows are written with SQL, so these tests do not
// depend on the generated Prisma client. Each test first writes a good row,
// so a refusal is the rule's doing and not a missing table. A refusal is
// told by its PostgreSQL error code: 23514 (a check), 23503 (a foreign key)
// and 23505 (a unique index).
describe('File rules (database)', () => {
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
  const FOREIGN_KEY = /23503/;
  const UNIQUE = /23505/;

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    return { ana, project, board, column, card };
  }

  interface FileRow {
    projectId: string;
    cardId: string | null;
    messageId: string | null;
    uploaderId: string | null;
    name: string;
    size: number;
    storageKey: string;
  }

  // Writes one row, with whatever `fields` change in a good row for `card`.
  function insertFile(
    base: { projectId: string; cardId: string; uploaderId: string },
    fields: Partial<FileRow> = {},
  ) {
    const row: FileRow = {
      cardId: base.cardId,
      messageId: null,
      projectId: base.projectId,
      uploaderId: base.uploaderId,
      name: 'plan.pdf',
      size: 1234,
      storageKey: `files/${randomUUID()}`,
      ...fields,
    };
    return prisma.$executeRaw`
      INSERT INTO files (id, project_id, card_id, message_id, uploader_id,
                         name, size, mime_type, storage_key, created_at)
      VALUES (${randomUUID()}::uuid, ${row.projectId}::uuid,
              ${row.cardId}::uuid, ${row.messageId}::uuid,
              ${row.uploaderId}::uuid, ${row.name}, ${row.size},
              'application/octet-stream', ${row.storageKey}, now())`;
  }

  async function fileCount(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  async function aMessage(ana: { id: string }, boardId: string) {
    const chat = await prisma.chat.create({
      data: { boardId, kind: 'GENERAL', title: 'General' },
    });
    return prisma.message.create({
      data: { chatId: chat.id, authorId: ana.id, body: 'Hi' },
    });
  }

  describe('who owns a file (criterion 7)', () => {
    // 7
    it('accepts a file of a card, and a file of a message', async () => {
      const { ana, project, board, card } = await setUp();
      const message = await aMessage(ana, board.id);
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };

      await expect(insertFile(base)).resolves.toBe(1);
      await expect(
        insertFile(base, { cardId: null, messageId: message.id }),
      ).resolves.toBe(1);
    });

    // 7
    it('refuses a file with both a card and a message', async () => {
      const { ana, project, board, card } = await setUp();
      const message = await aMessage(ana, board.id);
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };
      await expect(insertFile(base)).resolves.toBe(1);

      await expect(insertFile(base, { messageId: message.id })).rejects.toThrow(
        CHECK,
      );
    });

    // 7
    it('refuses a file with neither a card nor a message', async () => {
      const { ana, project, card } = await setUp();
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };
      await expect(insertFile(base)).resolves.toBe(1);

      await expect(insertFile(base, { cardId: null })).rejects.toThrow(CHECK);
    });
  });

  // 8
  it('refuses a card file in a different project from its card', async () => {
    const { ana, project, card } = await setUp();
    const other = await createProject(prisma, ana.id, 'Other', 'OTH');
    await expect(
      insertFile({
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      }),
    ).resolves.toBe(1);

    await expect(
      insertFile({
        projectId: other.id,
        cardId: card.id,
        uploaderId: ana.id,
      }),
    ).rejects.toThrow(FOREIGN_KEY);
  });

  describe('name, size and storage key (criterion 9)', () => {
    // 9
    it('keeps the name between 1 and 255 characters', async () => {
      const { ana, project, card } = await setUp();
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };

      await expect(insertFile(base, { name: 'x' })).resolves.toBe(1);
      await expect(insertFile(base, { name: 'x'.repeat(255) })).resolves.toBe(
        1,
      );
      await expect(insertFile(base, { name: '' })).rejects.toThrow(CHECK);
      await expect(insertFile(base, { name: 'x'.repeat(256) })).rejects.toThrow(
        CHECK,
      );
    });

    // 9
    it('counts characters, not bytes, in the name', async () => {
      const { ana, project, card } = await setUp();
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };

      // 255 characters that take 3 bytes each.
      await expect(insertFile(base, { name: '日'.repeat(255) })).resolves.toBe(
        1,
      );
    });

    // 9
    it('allows an empty file but not a negative size', async () => {
      const { ana, project, card } = await setUp();
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };

      await expect(insertFile(base, { size: 0 })).resolves.toBe(1);
      await expect(insertFile(base, { size: 5 * 1024 ** 3 })).resolves.toBe(1);
      await expect(insertFile(base, { size: -1 })).rejects.toThrow(CHECK);
    });

    // 9
    it('keeps every storage key unique', async () => {
      const { ana, project, card } = await setUp();
      const base = {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      };
      await expect(insertFile(base, { storageKey: 'files/a' })).resolves.toBe(
        1,
      );

      await expect(insertFile(base, { storageKey: 'files/a' })).rejects.toThrow(
        UNIQUE,
      );
    });
  });

  // 10
  it('keeps a file when its uploader’s account is deleted, and empties uploader_id', async () => {
    const { ana, project, card } = await setUp();
    const ben = await createUser(prisma, 'ben');
    await insertFile({
      projectId: project.id,
      cardId: card.id,
      uploaderId: ben.id,
    });
    await insertFile({
      projectId: project.id,
      cardId: card.id,
      uploaderId: ana.id,
    });

    await prisma.user.delete({ where: { id: ben.id } });

    const rows = await prisma.$queryRaw<
      { uploader_id: string | null }[]
    >`SELECT uploader_id FROM files ORDER BY uploader_id NULLS FIRST`;
    expect(rows).toEqual([{ uploader_id: null }, { uploader_id: ana.id }]);
  });

  describe('deleting what a file belongs to (criterion 11)', () => {
    // 11
    it('removes a card’s file rows with the card, and no one else’s', async () => {
      const { ana, project, board, column, card } = await setUp();
      const other = await createBareCard(prisma, {
        boardId: board.id,
        columnId: column.id,
      });
      const base = { projectId: project.id, uploaderId: ana.id };
      await insertFile({ ...base, cardId: card.id });
      await insertFile({ ...base, cardId: card.id });
      await insertFile({ ...base, cardId: other.id });

      await prisma.card.delete({ where: { id: card.id } });

      await expect(fileCount()).resolves.toBe(1);
    });

    // 11
    it('removes a project’s file rows with the project', async () => {
      const { ana, project, card } = await setUp();
      await insertFile({
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.id,
      });
      await expect(fileCount()).resolves.toBe(1);

      await prisma.project.delete({ where: { id: project.id } });

      await expect(fileCount()).resolves.toBe(0);
    });
  });

  describe('card history for files (criterion 32)', () => {
    function line(
      ids: { cardId: string; projectId: string; actorId: string },
      kind: string,
    ) {
      return prisma.$executeRaw`
        INSERT INTO card_activity (id, card_id, project_id, actor_id, kind,
                                   details, created_at)
        VALUES (${randomUUID()}::uuid, ${ids.cardId}::uuid,
                ${ids.projectId}::uuid, ${ids.actorId}::uuid,
                ${kind}::activity_kind,
                '{"fileId":"f","name":"plan.pdf","size":12}'::jsonb, now())`;
    }

    // 32
    it('has the kinds FILE_ADDED and FILE_REMOVED', async () => {
      const { ana, project, card } = await setUp();
      const ids = {
        cardId: card.id,
        projectId: project.id,
        actorId: ana.id,
      };

      await expect(line(ids, 'FILE_ADDED')).resolves.toBe(1);
      await expect(line(ids, 'FILE_REMOVED')).resolves.toBe(1);
    });

    // 31
    it('has the kind FILE_MOVED', async () => {
      const { ana, project, card } = await setUp();

      await expect(
        line(
          { cardId: card.id, projectId: project.id, actorId: ana.id },
          'FILE_MOVED',
        ),
      ).resolves.toBe(1);
    });

    // 32
    it('keeps the history of files append-only', async () => {
      const { ana, project, card } = await setUp();
      await line(
        { cardId: card.id, projectId: project.id, actorId: ana.id },
        'FILE_ADDED',
      );

      await expect(
        prisma.$executeRaw`UPDATE card_activity SET details = '{}'::jsonb WHERE kind = 'FILE_ADDED'::activity_kind`,
      ).rejects.toThrow('card history cannot be changed');
      await expect(
        prisma.$executeRaw`DELETE FROM card_activity WHERE kind = 'FILE_ADDED'::activity_kind`,
      ).rejects.toThrow('card history cannot be changed');
    });
  });
});
