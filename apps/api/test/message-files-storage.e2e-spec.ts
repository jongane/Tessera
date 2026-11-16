import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FILE_STORE } from '../src/storage/file-store.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario } from './support/files-scenario.js';

// Files on messages, PR B: storage that fails or is slow, with a fake storage
// (criteria 17 and 18, "their objects are deleted after it commits" and "if
// deleting an object fails, the failure is logged and the answer is still
// 200"). Uses the FILE_STORE token like files-storage-failures.e2e-spec.ts.
class FakeStore {
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  failDeletes = false;
  // Runs when a delete is asked for, before it works or fails.
  onDelete: (key: string) => Promise<void> = async () => {};

  reset(): void {
    this.objects = new Map();
    this.deleted = [];
    this.failDeletes = false;
    this.onDelete = async () => {};
  }

  async put(key: string, body: Readable): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    this.objects.set(key, Buffer.concat(chunks));
  }

  get(key: string): Promise<Readable> {
    const bytes = this.objects.get(key);
    if (!bytes) return Promise.reject(new Error('NoSuchKey'));
    return Promise.resolve(Readable.from([bytes]));
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    await this.onDelete(key);
    if (this.failDeletes) throw new Error('storage is down');
    this.objects.delete(key);
  }
}

describe('Files on messages when storage fails (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const store = new FakeStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORE)
      .useFactory({ factory: () => store })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    store.reset();
    await resetDatabase(prisma);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  async function twoFilesInAMessage() {
    const scenario = await messageFileScenario(app);
    const { cara, general, pend, sendWith } = scenario;
    const a = await pend(cara, general.id, 'a.pdf');
    const b = await pend(cara, general.id, 'b.pdf');
    const sent = await sendWith(cara, general.id, 'Two files', [a.id, b.id]);
    return { ...scenario, a, b, sent };
  }

  // 17
  it('deletes the objects of a deleted message only after its rows are gone', async () => {
    const { cara, sent } = await twoFilesInAMessage();
    expect(store.objects.size).toBe(2);
    const rowsAtEachDelete: number[] = [];
    store.onDelete = async () => {
      rowsAtEachDelete.push(await fileRows());
    };

    await cara.agent.delete(`/api/messages/${sent.id}`).expect(200);

    expect(store.deleted).toHaveLength(2);
    expect(rowsAtEachDelete).toEqual([0, 0]);
    expect(store.objects.size).toBe(0);
  });

  // 17
  it('logs a failure to delete an object, still answers 200 and has removed the rows', async () => {
    const { cara, sent } = await twoFilesInAMessage();
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    store.failDeletes = true;

    const response = await cara.agent
      .delete(`/api/messages/${sent.id}`)
      .expect(200);

    expect(response.body.files).toEqual([]);
    expect(response.body.deletedAt).not.toBeNull();
    expect(await fileRows()).toBe(0);
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain('storage is down');
  });

  // 17
  it('deletes only the objects of the message that is deleted', async () => {
    const { ana, cara, general, pend, sendWith, sent } =
      await twoFilesInAMessage();
    const other = await pend(ana, general.id, 'other.pdf');
    await sendWith(ana, general.id, 'Ana’s', [other.id]);
    expect(store.objects.size).toBe(3);

    await cara.agent.delete(`/api/messages/${sent.id}`).expect(200);

    expect(store.deleted).toHaveLength(2);
    expect(store.objects.size).toBe(1);
    expect(await fileRows()).toBe(1);
  });

  // 18
  it('removes the row of a message file before its object, and still answers 204 when the object cannot be deleted', async () => {
    const { cara, a } = await twoFilesInAMessage();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const rowsAtDelete: number[] = [];
    store.onDelete = async () => {
      rowsAtDelete.push(await fileRows());
    };
    store.failDeletes = true;

    await cara.agent.delete(`/api/files/${a.id}`).expect(204);

    expect(rowsAtDelete).toEqual([1]);
    expect(await fileRows()).toBe(1);
  });
});
