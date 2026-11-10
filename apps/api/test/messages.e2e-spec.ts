import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { Message } from '@tessera/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import { resetDatabase } from './support/reset-database.js';
import { startTestApp } from './support/test-app.js';

// Chat messages PR: GET and POST /api/chats/:chatId/messages, PATCH and
// DELETE /api/messages/:messageId (plan "API").
const NUL_MESSAGE = 'This contains a hidden character that can’t be saved';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface MessagePage {
  messages: Message[];
  hasOlder: boolean;
}

describe('Chat messages (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await startTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  // Ana (project admin) and Cara (plain member) can use the board's general
  // chat. Ben is not a member of the project.
  async function setUp() {
    const scenario = await boardScenario(app);
    const chats = (await scenario.ana.agent.get(
      `/api/boards/${scenario.board.id}/chats`,
    )) as { body: { id: string; kind: string }[] };
    const chat = chats.body.find((c) => c.kind === 'GENERAL')!;
    return {
      ...scenario,
      chat,
      messagesUrl: `/api/chats/${chat.id}/messages`,
    };
  }

  type Scenario = Awaited<ReturnType<typeof setUp>>;
  type Person = Scenario['ana'];

  async function send(
    person: Person,
    messagesUrl: string,
    body: string,
  ): Promise<Message> {
    const response = await person.agent
      .post(messagesUrl)
      .send({ body })
      .expect(201);
    return response.body as Message;
  }

  // Puts `count` messages by Ana straight into the database, called
  // "m001", "m002", ... with a time one second after the previous one.
  async function seed(chatId: string, authorId: string, count: number) {
    await prisma.$executeRaw`
      INSERT INTO messages (id, chat_id, author_id, body, created_at)
      SELECT gen_random_uuid(), ${chatId}::uuid, ${authorId}::uuid,
             'm' || lpad(n::text, 3, '0'),
             timestamptz '2026-11-09 10:00:00+00' + n * interval '1 second'
      FROM generate_series(1, ${count}) AS n`;
  }

  async function page(person: Person, url: string): Promise<MessagePage> {
    return (await person.agent.get(url).expect(200)).body as MessagePage;
  }

  const bodies = (p: MessagePage) => p.messages.map((m) => m.body);
  const range = (from: number, to: number) =>
    Array.from(
      { length: to - from + 1 },
      (_, i) => `m${String(from + i).padStart(3, '0')}`,
    );

  describe('sending', () => {
    // Criterion 7
    it('answers 201 with the message, written by the signed-in person', async () => {
      const { cara, chat, messagesUrl } = await setUp();

      const response = await cara.agent
        .post(messagesUrl)
        .send({ body: '  Hello **team**  ' })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        chatId: chat.id,
        body: 'Hello **team**',
        createdAt: expect.any(String),
        editedAt: null,
        deletedAt: null,
        author: { id: cara.user.id, displayName: 'cara' },
        deletedBy: null,
      });
      const listed = await page(cara, messagesUrl);
      expect(bodies(listed)).toEqual(['Hello **team**']);
    });

    // Criterion 7
    it('refuses a blank, a too long or a NUL message with 400 and the shared message', async () => {
      const { ana, messagesUrl } = await setUp();

      const tooLong = await ana.agent
        .post(messagesUrl)
        .send({ body: 'x'.repeat(10_001) });
      expect(tooLong.status).toBe(400);
      expect(String(tooLong.body.message)).toContain(
        'Use at most 10000 characters',
      );

      const nul = await ana.agent.post(messagesUrl).send({ body: 'a\u0000b' });
      expect(nul.status).toBe(400);
      expect(String(nul.body.message)).toContain(NUL_MESSAGE);

      await ana.agent.post(messagesUrl).send({ body: '   ' }).expect(400);
      await ana.agent.post(messagesUrl).send({}).expect(400);
      await send(ana, messagesUrl, 'x'.repeat(10_000));
      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ body: 'x'.repeat(10_000) }],
      });
    });
  });

  describe('listing and paging', () => {
    // Criterion 8
    it('lists an empty chat as no messages and nothing older', async () => {
      const { ana, messagesUrl } = await setUp();

      expect(await page(ana, messagesUrl)).toEqual({
        messages: [],
        hasOlder: false,
      });
    });

    // Criterion 8
    it('lists the newest 50, oldest first, and says there are older ones', async () => {
      const { ana, chat, messagesUrl } = await setUp();
      await seed(chat.id, ana.user.id, 120);

      const newest = await page(ana, messagesUrl);

      expect(bodies(newest)).toEqual(range(71, 120));
      expect(newest.hasOlder).toBe(true);
    });

    // Criterion 8
    it('says nothing is older when the chat has exactly 50 messages', async () => {
      const { ana, chat, messagesUrl } = await setUp();
      await seed(chat.id, ana.user.id, 50);

      const newest = await page(ana, messagesUrl);

      expect(bodies(newest)).toEqual(range(1, 50));
      expect(newest.hasOlder).toBe(false);
    });

    // Criterion 8
    it('with before, lists the 50 sent just before that message, in the same order', async () => {
      const { ana, chat, messagesUrl } = await setUp();
      await seed(chat.id, ana.user.id, 120);
      const newest = await page(ana, messagesUrl);

      const second = await page(
        ana,
        `${messagesUrl}?before=${newest.messages[0]!.id}`,
      );
      expect(bodies(second)).toEqual(range(21, 70));
      expect(second.hasOlder).toBe(true);

      const third = await page(
        ana,
        `${messagesUrl}?before=${second.messages[0]!.id}`,
      );
      expect(bodies(third)).toEqual(range(1, 20));
      expect(third.hasOlder).toBe(false);
    });

    // Criterion 8
    it('never repeats or loses a message when several have the same time', async () => {
      const { ana, chat, messagesUrl } = await setUp();
      await prisma.$executeRaw`
        INSERT INTO messages (id, chat_id, author_id, body, created_at)
        SELECT gen_random_uuid(), ${chat.id}::uuid, ${ana.user.id}::uuid,
               'same ' || n, timestamptz '2026-11-09 10:00:00+00'
        FROM generate_series(1, 120) AS n`;

      const first = await page(ana, messagesUrl);
      const second = await page(
        ana,
        `${messagesUrl}?before=${first.messages[0]!.id}`,
      );
      const third = await page(
        ana,
        `${messagesUrl}?before=${second.messages[0]!.id}`,
      );

      const ids = [
        ...third.messages,
        ...second.messages,
        ...first.messages,
      ].map((m) => m.id);
      expect(ids).toHaveLength(120);
      expect(new Set(ids).size).toBe(120);
      // The order is (created_at, id): with one time, by id.
      expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
      expect(third.hasOlder).toBe(false);
    });

    // Criterion 12
    it('still lists a deleted message, with its body, deletedAt and deletedBy', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Oops, wrong chat');
      await ana.agent.delete(`/api/messages/${message.id}`).expect(200);

      const listed = await page(cara, messagesUrl);

      expect(listed.messages).toHaveLength(1);
      expect(listed.messages[0]).toMatchObject({
        id: message.id,
        body: 'Oops, wrong chat',
        deletedAt: expect.any(String),
        deletedBy: { id: ana.user.id, displayName: 'ana' },
      });
    });
  });

  describe('who may use a chat', () => {
    // Criterion 9
    it('gives a non-member 404 "Chat not found" for GET and POST', async () => {
      const { ana, ben, messagesUrl } = await setUp();
      await send(ana, messagesUrl, 'Private to the project');

      const get = await ben.agent.get(messagesUrl);
      expect(get.status).toBe(404);
      expect(get.body.message).toBe('Chat not found');
      expect(JSON.stringify(get.body)).not.toContain('Private to the project');

      const post = await ben.agent.post(messagesUrl).send({ body: 'Hi' });
      expect(post.status).toBe(404);
      expect(post.body.message).toBe('Chat not found');
      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ body: 'Private to the project' }],
      });
    });

    // Criterion 9
    it('gives a non-member 404 "Message not found" for PATCH and DELETE', async () => {
      const { ana, ben, messagesUrl } = await setUp();
      const message = await send(ana, messagesUrl, 'Mine');

      const patch = await ben.agent
        .patch(`/api/messages/${message.id}`)
        .send({ body: 'Hacked' });
      expect(patch.status).toBe(404);
      expect(patch.body.message).toBe('Message not found');

      const del = await ben.agent.delete(`/api/messages/${message.id}`);
      expect(del.status).toBe(404);
      expect(del.body.message).toBe('Message not found');

      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ body: 'Mine', editedAt: null, deletedAt: null }],
      });
    });

    // Criterion 9
    it('gives 404 for an unknown id and 400 for a malformed one', async () => {
      const { ana } = await setUp();

      await ana.agent.get(`/api/chats/${UNKNOWN_ID}/messages`).expect(404);
      await ana.agent
        .post(`/api/chats/${UNKNOWN_ID}/messages`)
        .send({ body: 'Hi' })
        .expect(404);
      await ana.agent
        .patch(`/api/messages/${UNKNOWN_ID}`)
        .send({ body: 'Hi' })
        .expect(404);
      await ana.agent.delete(`/api/messages/${UNKNOWN_ID}`).expect(404);

      await ana.agent.get('/api/chats/not-a-uuid/messages').expect(400);
      await ana.agent
        .post('/api/chats/not-a-uuid/messages')
        .send({ body: 'Hi' })
        .expect(400);
      await ana.agent
        .patch('/api/messages/not-a-uuid')
        .send({ body: 'Hi' })
        .expect(400);
      await ana.agent.delete('/api/messages/not-a-uuid').expect(400);
    });

    // Criterion 9
    it('refuses a before id from another chat without leaking its messages', async () => {
      const { ana, board, messagesUrl } = await setUp();
      const topic = (
        await ana.agent
          .post(`/api/boards/${board.id}/chats`)
          .send({ title: 'Release plan' })
          .expect(201)
      ).body as { id: string };
      const otherUrl = `/api/chats/${topic.id}/messages`;
      await send(ana, messagesUrl, 'General talk');
      const secret = await send(ana, otherUrl, 'Release secret');
      await send(ana, otherUrl, 'Release secret two');

      const response = await ana.agent.get(
        `${messagesUrl}?before=${secret.id}`,
      );

      expect([400, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain('Release secret');
      expect(JSON.stringify(response.body)).not.toContain('General talk');
    });
  });

  describe('editing', () => {
    // Criterion 10
    it('lets the author edit, sets editedAt and returns the message', async () => {
      const { cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Helo');

      const response = await cara.agent
        .patch(`/api/messages/${message.id}`)
        .send({ body: ' Hello ' })
        .expect(200);

      expect(response.body).toMatchObject({
        id: message.id,
        body: 'Hello',
        editedAt: expect.any(String),
        deletedAt: null,
        author: { id: cara.user.id, displayName: 'cara' },
      });
      const listed = await page(cara, messagesUrl);
      expect(listed.messages[0]).toMatchObject({
        body: 'Hello',
        editedAt: response.body.editedAt,
      });
    });

    // Criterion 10
    it('refuses an edit that is blank or too long, keeping the message', async () => {
      const { cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Hello');
      const url = `/api/messages/${message.id}`;

      await cara.agent.patch(url).send({ body: '  ' }).expect(400);
      const tooLong = await cara.agent
        .patch(url)
        .send({ body: 'x'.repeat(10_001) });
      expect(tooLong.status).toBe(400);
      expect(String(tooLong.body.message)).toContain(
        'Use at most 10000 characters',
      );
      expect(await page(cara, messagesUrl)).toMatchObject({
        messages: [{ body: 'Hello', editedAt: null }],
      });
    });

    // Criterion 10
    it('gives 403 to anyone but the author, a project admin included', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      const byCara = await send(cara, messagesUrl, 'Cara’s message');
      const byAna = await send(ana, messagesUrl, 'Ana’s message');

      await ana.agent
        .patch(`/api/messages/${byCara.id}`)
        .send({ body: 'Edited by the admin' })
        .expect(403);
      await cara.agent
        .patch(`/api/messages/${byAna.id}`)
        .send({ body: 'Edited by a member' })
        .expect(403);

      expect((await page(ana, messagesUrl)).messages).toMatchObject([
        { body: 'Cara’s message', editedAt: null },
        { body: 'Ana’s message', editedAt: null },
      ]);
    });

    // Criterion 10
    it('gives 409 "This message was deleted" for an edit of a deleted message', async () => {
      const { cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Hello');
      await cara.agent.delete(`/api/messages/${message.id}`).expect(200);

      const response = await cara.agent
        .patch(`/api/messages/${message.id}`)
        .send({ body: 'Back again' });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('This message was deleted');
      expect(await page(cara, messagesUrl)).toMatchObject({
        messages: [{ body: 'Hello', editedAt: null }],
      });
    });
  });

  describe('deleting', () => {
    // Criterion 11
    it('lets the author delete, keeping the body, and returns the message', async () => {
      const { cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Hello');

      const response = await cara.agent
        .delete(`/api/messages/${message.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: message.id,
        body: 'Hello',
        deletedAt: expect.any(String),
        deletedBy: { id: cara.user.id, displayName: 'cara' },
      });
    });

    // Criterion 11
    it('lets a project admin delete someone else’s message', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Hello');

      const response = await ana.agent
        .delete(`/api/messages/${message.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        body: 'Hello',
        author: { id: cara.user.id },
        deletedAt: expect.any(String),
        deletedBy: { id: ana.user.id, displayName: 'ana' },
      });
    });

    // Criterion 11
    it('gives another plain member 403 and keeps the message', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      const message = await send(ana, messagesUrl, 'Hello');

      await cara.agent.delete(`/api/messages/${message.id}`).expect(403);

      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ body: 'Hello', deletedAt: null, deletedBy: null }],
      });
    });

    // Criterion 11
    it('gives 409 for a message that is already deleted, and keeps who deleted it first', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      const message = await send(cara, messagesUrl, 'Hello');
      await cara.agent.delete(`/api/messages/${message.id}`).expect(200);

      await ana.agent.delete(`/api/messages/${message.id}`).expect(409);

      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ deletedBy: { id: cara.user.id } }],
      });
    });
  });

  describe('nesting (criterion 37)', () => {
    const levels = (n: number) => '> '.repeat(n) + 'x';

    // 37
    it('accepts 10 levels and refuses 11 with 400 and the message, on sending and on editing', async () => {
      const { ana, messagesUrl } = await setUp();
      const sent = await send(ana, messagesUrl, levels(10));

      const tooDeep = await ana.agent
        .post(messagesUrl)
        .send({ body: levels(11) });
      expect(tooDeep.status).toBe(400);
      expect(String(tooDeep.body.message)).toContain(
        'Use at most 10 levels of lists and quotes',
      );
      const edit = await ana.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: '- '.repeat(11) + 'x' });
      expect(edit.status).toBe(400);
      expect(String(edit.body.message)).toContain(
        'Use at most 10 levels of lists and quotes',
      );
      expect((await page(ana, messagesUrl)).messages).toHaveLength(1);
    });
  });

  describe('sending again with the same id (criterion 39)', () => {
    const ID = '3f2b8c1e-9d4a-4f6b-8a1c-2e7d5b9a0c11';

    // 39
    it('saves a message with the id it was sent with', async () => {
      const { ana, messagesUrl } = await setUp();

      const response = await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: ID })
        .expect(201);

      expect(response.body.id).toBe(ID);
    });

    // 39
    it('answers 200 with the same message when the same author sends the same id again, and saves nothing new', async () => {
      const { ana, messagesUrl } = await setUp();
      const first = await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: ID })
        .expect(201);

      const again = await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: ID })
        .expect(200);

      expect(again.body).toEqual(first.body);
      expect((await page(ana, messagesUrl)).messages).toHaveLength(1);
    });

    // 39
    it('refuses the same id from another person with 409, and saves nothing', async () => {
      const { ana, cara, messagesUrl } = await setUp();
      await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: ID })
        .expect(201);

      await cara.agent
        .post(messagesUrl)
        .send({ body: 'Mine', id: ID })
        .expect(409);

      expect(await page(ana, messagesUrl)).toMatchObject({
        messages: [{ body: 'Hello', author: { id: ana.user.id } }],
      });
    });

    // 39
    it('refuses the same id in another chat with 409, even from the same author', async () => {
      const { ana, board, messagesUrl } = await setUp();
      const topic = (
        await ana.agent
          .post(`/api/boards/${board.id}/chats`)
          .send({ title: 'Release plan' })
          .expect(201)
      ).body as { id: string };
      await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: ID })
        .expect(201);

      await ana.agent
        .post(`/api/chats/${topic.id}/messages`)
        .send({ body: 'Hello', id: ID })
        .expect(409);

      expect(await page(ana, `/api/chats/${topic.id}/messages`)).toMatchObject({
        messages: [],
      });
    });

    // 39
    it('refuses an id that is not a UUID with 400', async () => {
      const { ana, messagesUrl } = await setUp();

      await ana.agent
        .post(messagesUrl)
        .send({ body: 'Hello', id: 'not-a-uuid' })
        .expect(400);
    });
  });
});
