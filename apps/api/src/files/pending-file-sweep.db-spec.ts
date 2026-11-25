import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FileStore } from '../storage/file-store.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createProject,
  createUser,
} from '../../test/support/factories.js';
import { PendingFileSweep } from './pending-file-sweep.js';

// Files on messages, PR B, criterion 9 (Jon, 2026-11-25): the sweep of pending
// files is its own small unit. Contract these tests assume:
//   src/files/pending-file-sweep.ts exports `PendingFileSweep`, an injectable
//   class with the constructor (prisma: PrismaService, store: FileStore)
//   (Nest injects PrismaService and the FILE_STORE token), and
//   run(now: Date): Promise<void>. It deletes every pending file (pending_chat_id
//   set) created more than 24 hours before `now`: the row first, then the
//   object. A failed object delete is logged (Logger.error) and the sweep goes
//   on. Sent files and card files are never touched. The clock is only `now`.
const HOUR = 3_600_000;
const NOW = new Date('2026-11-25T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe('PendingFileSweep (database)', () => {
  let prisma: PrismaService;
  let deleted: string[];
  let rowsWhenDeleting: number[];
  let failFor: Set<string>;
  let sweep: PendingFileSweep;

  const store: FileStore = {
    put: () => Promise.resolve(),
    get: () => Promise.reject(new Error('not needed')),
    delete: async (key: string) => {
      deleted.push(key);
      rowsWhenDeleting.push(await fileCount());
      if (failFor.has(key)) throw new Error('storage is down');
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    deleted = [];
    rowsWhenDeleting = [];
    failFor = new Set();
    sweep = new PendingFileSweep(prisma, store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fileCount(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    const chat = await prisma.chat.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });
    const message = await prisma.message.create({
      data: { chatId: chat.id, authorId: ana.id, body: 'Hi' },
    });
    // Writes a row; the owner is one of pending, message, card.
    async function file(
      owner: 'pending' | 'message' | 'card',
      createdAt: Date,
      key = `files/${randomUUID()}`,
    ) {
      await prisma.$executeRaw`
        INSERT INTO files (id, project_id, card_id, message_id, pending_chat_id,
                           uploader_id, name, size, mime_type, storage_key,
                           created_at)
        VALUES (${randomUUID()}::uuid, ${project.id}::uuid,
                ${owner === 'card' ? card.id : null}::uuid,
                ${owner === 'message' ? message.id : null}::uuid,
                ${owner === 'pending' ? chat.id : null}::uuid,
                ${ana.id}::uuid, 'plan.pdf', 12, 'application/octet-stream',
                ${key}, ${createdAt}::timestamptz)`;
      return key;
    }
    return { file };
  }

  // 9
  it('deletes pending files older than 24 hours, row first and then object', async () => {
    const { file } = await setUp();
    const old = await file('pending', ago(25));
    await file('pending', ago(23));

    await sweep.run(NOW);

    expect(deleted).toEqual([old]);
    expect(rowsWhenDeleting).toEqual([1]);
    expect(await fileCount()).toBe(1);
  });

  // 9
  it('uses the clock it is given: the same rows are young at an earlier time', async () => {
    const { file } = await setUp();
    await file('pending', ago(25));

    await sweep.run(new Date(NOW.getTime() - 2 * HOUR));

    expect(deleted).toEqual([]);
    expect(await fileCount()).toBe(1);
  });

  // 9
  it('never touches sent files or card files, however old', async () => {
    const { file } = await setUp();
    await file('message', ago(500));
    await file('card', ago(500));

    await sweep.run(NOW);

    expect(deleted).toEqual([]);
    expect(await fileCount()).toBe(2);
  });

  // 9
  it('logs a failed object delete, keeps going with the next file, and does not throw', async () => {
    const { file } = await setUp();
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const first = await file('pending', ago(30));
    const second = await file('pending', ago(26));
    failFor.add(first);

    await expect(sweep.run(NOW)).resolves.toBeUndefined();

    expect([...deleted].sort()).toEqual([first, second].sort());
    expect(await fileCount()).toBe(0);
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain('storage is down');
  });

  // 9
  it('does nothing when there is nothing old', async () => {
    await setUp();

    await expect(sweep.run(NOW)).resolves.toBeUndefined();

    expect(deleted).toEqual([]);
  });
});
