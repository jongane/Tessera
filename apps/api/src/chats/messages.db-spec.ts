import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// Chat messages PR. These tests write to the messages table with plain SQL,
// skipping the services, to prove the database itself keeps its rules. They
// use SQL because the Prisma client only knows the table after the migration.
describe('Messages table (database)', () => {
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

  // Ana's project with a board and its general chat.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id);
    const { board } = await createBareBoard(prisma, project.id);
    const chat = await prisma.chat.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });
    return { ana, project, board, chat };
  }

  interface NewMessage {
    chatId: string;
    authorId: string | null;
    body?: string;
    deletedAt?: Date | null;
    deletedById?: string | null;
  }

  function insertMessage(m: NewMessage) {
    return prisma.$executeRaw`
      INSERT INTO messages (id, chat_id, author_id, body, deleted_at, deleted_by_id)
      VALUES (gen_random_uuid(), ${m.chatId}::uuid, ${m.authorId}::uuid,
              ${m.body ?? 'Hello'}, ${m.deletedAt ?? null}::timestamptz,
              ${m.deletedById ?? null}::uuid)`;
  }

  function countMessages(): Promise<number> {
    return prisma.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM messages`.then((rows) => rows[0]!.n);
  }

  // Criterion 3
  it('has the columns of a message', async () => {
    await setUp();

    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'messages'`;

    expect(columns.map((c) => c.column_name).sort()).toEqual(
      [
        'id',
        'chat_id',
        'author_id',
        'body',
        'created_at',
        'edited_at',
        'deleted_at',
        'deleted_by_id',
      ].sort(),
    );
  });

  // Criterion 3
  it('stores a message with its time set, and nothing edited or deleted', async () => {
    const { ana, chat } = await setUp();

    await insertMessage({ chatId: chat.id, authorId: ana.id, body: 'Hi all' });

    const [row] = await prisma.$queryRaw<
      {
        body: string;
        author_id: string;
        created_at: Date;
        edited_at: Date | null;
        deleted_at: Date | null;
        deleted_by_id: string | null;
      }[]
    >`SELECT * FROM messages`;
    expect(row).toMatchObject({
      body: 'Hi all',
      author_id: ana.id,
      edited_at: null,
      deleted_at: null,
      deleted_by_id: null,
    });
    expect(row!.created_at).toBeInstanceOf(Date);
  });

  // Criterion 4
  it('deletes the messages of a board’s chats with the board', async () => {
    const { ana, board, chat } = await setUp();
    await insertMessage({ chatId: chat.id, authorId: ana.id });
    await insertMessage({ chatId: chat.id, authorId: ana.id, body: 'Again' });

    await prisma.board.delete({ where: { id: board.id } });

    await expect(prisma.chat.count()).resolves.toBe(0);
    await expect(countMessages()).resolves.toBe(0);
  });

  // Criterion 5
  it('refuses deleted_by_id without deleted_at', async () => {
    const { ana, chat } = await setUp();

    await expect(
      insertMessage({
        chatId: chat.id,
        authorId: ana.id,
        deletedAt: null,
        deletedById: ana.id,
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(countMessages()).resolves.toBe(0);
  });

  // Criterion 5
  it('allows deleted_at without deleted_by_id, and both together', async () => {
    const { ana, chat } = await setUp();

    await insertMessage({
      chatId: chat.id,
      authorId: ana.id,
      deletedAt: new Date(),
      deletedById: null,
    });
    await insertMessage({
      chatId: chat.id,
      authorId: ana.id,
      deletedAt: new Date(),
      deletedById: ana.id,
    });

    await expect(countMessages()).resolves.toBe(2);
  });

  // Criterion 6
  it('keeps a message when its author’s account is deleted, with author_id and deleted_by_id set to null', async () => {
    const { ana, chat } = await setUp();
    const ben = await createUser(prisma, 'ben');
    await insertMessage({
      chatId: chat.id,
      authorId: ben.id,
      body: 'Ben’s words',
      deletedAt: new Date(),
      deletedById: ben.id,
    });
    await insertMessage({
      chatId: chat.id,
      authorId: ana.id,
      body: 'Ana’s words',
      deletedAt: new Date(),
      deletedById: ben.id,
    });

    await prisma.$executeRaw`DELETE FROM users WHERE id = ${ben.id}::uuid`;

    const rows = await prisma.$queryRaw<
      {
        body: string;
        author_id: string | null;
        deleted_at: Date | null;
        deleted_by_id: string | null;
      }[]
    >`SELECT body, author_id, deleted_at, deleted_by_id FROM messages ORDER BY body`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      body: 'Ana’s words',
      author_id: ana.id,
      deleted_by_id: null,
    });
    expect(rows[0]!.deleted_at).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({
      body: 'Ben’s words',
      author_id: null,
      deleted_by_id: null,
    });
    expect(rows[1]!.deleted_at).toBeInstanceOf(Date);
  });
});
