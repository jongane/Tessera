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
import { fileScenario, upload } from './support/files-scenario.js';

// Files on cards, PR A: what happens when the storage or the database fails
// part way, with a fake storage (acceptance criteria 28, 29, 30 and the
// order of deleting in 31). The plan calls 28 and 29 unit tests; they need a
// database for the rows, so they live with the end-to-end tests, and use no
// real storage.
//
// Contract these tests assume (decision 14: storage sits behind a small
// FileStore interface, put, get and delete, so tests can swap in a fake):
// `src/storage/file-store.ts` exports the injection token `FILE_STORE`. The
// app uses whatever is provided under it for every object, and does not need
// the S3 settings when it is replaced.
//   put(key: string, body: Readable): Promise<void>   (reads the stream)
//   get(key: string): Promise<Readable>
//   delete(key: string): Promise<void>
class FakeStore {
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  failDeletes = false;
  // Runs after a put has read the whole file, before it answers.
  afterPut: (key: string) => Promise<void> = async () => {};
  // Runs when a delete is asked for.
  onDelete: (key: string) => Promise<void> = async () => {};

  async put(key: string, body: Readable): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    this.objects.set(key, Buffer.concat(chunks));
    await this.afterPut(key);
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

describe('Files when storage or the database fails (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let store: FakeStore;

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
    store = new FakeStore();
    await resetDatabase(prisma);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const bytes = Buffer.from('%PDF-1.7 a plan');

  async function fileRows(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  // 29
  it('deletes the stored object again when saving the row fails', async () => {
    const { ana, card } = await fileScenario(app);
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      new Error('the database is down'),
    );
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const response = await upload(ana.agent, card.id, {
      filename: 'plan.pdf',
      data: bytes,
    });

    expect(response.status).toBe(500);
    expect(store.deleted).toHaveLength(1);
    expect(store.objects.size).toBe(0);
    expect(await fileRows()).toBe(0);
  });

  // 30
  it('answers 404 "Card not found" and deletes the object again when the card is deleted during the upload', async () => {
    const { ana, card } = await fileScenario(app);
    store.afterPut = async () => {
      await ana.agent.delete(`/api/cards/${card.id}`).expect(204);
    };

    const response = await upload(ana.agent, card.id, {
      filename: 'plan.pdf',
      data: bytes,
    }).expect(404);

    expect(String(response.body.message)).toContain('Card not found');
    expect(store.deleted).toHaveLength(1);
    expect(store.objects.size).toBe(0);
    expect(await fileRows()).toBe(0);
  });

  // 28
  it('still answers 204 and logs the failure when the object cannot be deleted after the row is gone', async () => {
    const { ana, card } = await fileScenario(app);
    const file = (
      await upload(ana.agent, card.id, {
        filename: 'plan.pdf',
        data: bytes,
      }).expect(201)
    ).body as { id: string };
    store.failDeletes = true;
    const errors = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const warnings = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    await ana.agent.delete(`/api/files/${file.id}`).expect(204);

    expect(
      errors.mock.calls.length + warnings.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(await fileRows()).toBe(0);
    const list = await ana.agent.get(`/api/cards/${card.id}/files`);
    expect(list.body.files).toEqual([]);
    const activity = await ana.agent.get(`/api/cards/${card.id}/activity`);
    expect(activity.body.items[0].kind).toBe('FILE_REMOVED');
  });

  // 28
  it('deletes the row before the object, so a failed object delete never shows the file again', async () => {
    const { ana, card } = await fileScenario(app);
    const file = (
      await upload(ana.agent, card.id, {
        filename: 'plan.pdf',
        data: bytes,
      }).expect(201)
    ).body as { id: string };
    let rowsWhenObjectDeleted = -1;
    store.onDelete = async () => {
      rowsWhenObjectDeleted = await fileRows();
    };

    await ana.agent.delete(`/api/files/${file.id}`).expect(204);

    expect(rowsWhenObjectDeleted).toBe(0);
  });

  // 31 (the objects go after the card is gone)
  it('deletes the objects of a deleted card’s files after the card is gone, and answers 204 even if the store fails', async () => {
    const { ana, card } = await fileScenario(app);
    await upload(ana.agent, card.id, { filename: 'a.pdf', data: bytes }).expect(
      201,
    );
    await upload(ana.agent, card.id, { filename: 'b.pdf', data: bytes }).expect(
      201,
    );
    const keys = [...store.objects.keys()].sort();
    expect(keys).toHaveLength(2);
    let cardStillThere: boolean | null = null;
    store.onDelete = async () => {
      cardStillThere =
        (await prisma.card.count({ where: { id: card.id } })) === 1;
    };
    store.failDeletes = true;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await ana.agent.delete(`/api/cards/${card.id}`).expect(204);

    expect([...store.deleted].sort()).toEqual(keys);
    expect(cardStillThere).toBe(false);
  });

  // 31 (moving keeps the objects)
  it('does not touch the storage when the files move to another card', async () => {
    const { ana, card, newCard } = await fileScenario(app);
    await upload(ana.agent, card.id, { filename: 'a.pdf', data: bytes }).expect(
      201,
    );
    const target = await newCard('Target');

    await ana.agent
      .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
      .expect(204);

    expect(store.deleted).toEqual([]);
    expect(store.objects.size).toBe(1);
  });
});
