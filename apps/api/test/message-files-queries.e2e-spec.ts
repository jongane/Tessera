import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { messageFileScenario } from './support/files-scenario.js';

// Files on messages, PR B, criterion 16 (Jon, 2026-11-25): listing messages
// with their files does not run one extra query per message. The app gets a
// Prisma client that logs query events, in place of PrismaService, and the
// test compares the number of queries for a chat of 5 messages with the number
// for a chat of 50 messages with 3 files each.
describe('Listing messages with files (queries)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let queries = 0;

  beforeAll(async () => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }),
      log: [{ emit: 'event', level: 'query' }],
    });
    client.$on('query', () => {
      queries += 1;
    });
    Object.assign(client, {
      onModuleDestroy: () => client.$disconnect(),
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(client)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  // Puts `count` messages by Ana into a chat, each with 3 sent files.
  async function seed(
    projectId: string,
    chatId: string,
    authorId: string,
    count: number,
  ) {
    for (let n = 1; n <= count; n++) {
      const messageId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO messages (id, chat_id, author_id, body, created_at)
        VALUES (${messageId}::uuid, ${chatId}::uuid, ${authorId}::uuid,
                ${'m' + n}, timestamptz '2026-11-09 10:00:00+00' + ${n} * interval '1 second')`;
      for (let f = 0; f < 3; f++) {
        await prisma.$executeRaw`
          INSERT INTO files (id, project_id, message_id, uploader_id, name, size,
                             mime_type, storage_key, created_at)
          VALUES (${randomUUID()}::uuid, ${projectId}::uuid, ${messageId}::uuid,
                  ${authorId}::uuid, ${`f${f}.pdf`}, 12,
                  'application/octet-stream', ${`files/${randomUUID()}`},
                  timestamptz '2026-11-09 10:00:00+00' + ${n * 10 + f} * interval '1 second')`;
      }
    }
  }

  async function listed(
    who: { agent: { get: (url: string) => PromiseLike<{ body: unknown }> } },
    chatId: string,
  ) {
    queries = 0;
    const response = await who.agent.get(`/api/chats/${chatId}/messages`);
    const messages = (response.body as { messages: { files: unknown[] }[] })
      .messages;
    return { messages, count: queries };
  }

  // 16
  it('runs no more queries for 50 messages with files than for 5', async () => {
    const { ana, project, general, cardChat } = await messageFileScenario(app);
    await seed(project.id, cardChat.id, ana.user.id, 5);
    await seed(project.id, general.id, ana.user.id, 50);

    const few = await listed(ana, cardChat.id);
    const many = await listed(ana, general.id);

    // The files are really there, 3 for every message.
    expect(few.messages).toHaveLength(5);
    expect(many.messages).toHaveLength(50);
    for (const m of [...few.messages, ...many.messages]) {
      expect(m.files).toHaveLength(3);
    }
    expect(many.count).toBe(few.count);
  });
});
