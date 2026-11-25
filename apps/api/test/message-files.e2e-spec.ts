import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { NUL_MESSAGE } from '@tessera/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  type FileJson,
  messageFileScenario,
  type MessageJson,
  part,
  upload,
  uploadPartsToChat,
  uploadToChat,
} from './support/files-scenario.js';
import {
  closeAllSockets,
  connect,
  cookieOf,
  join,
  LIVE_HEADER,
  type LiveClient,
  quiet,
  startLiveApp,
  until,
} from './support/live.js';
import { HTML_BYTES, PNG_BYTES, SVG_BYTES } from './support/multipart.js';
import {
  emptyBucket,
  getObject,
  listKeys,
  objectExists,
  testBucket,
} from './support/storage.js';

// Files on messages, PR B (plan "files on messages, and screenshots in the
// message box"): the API against real PostgreSQL and real SeaweedFS
// (acceptance criteria 4 to 8, 10 to 23). The size limit is in
// message-files-limit.e2e-spec.ts, the sweep in
// message-files-sweep.e2e-spec.ts, and storage that fails in
// message-files-storage.e2e-spec.ts.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PDF = Buffer.from('%PDF-1.7 pretend this is a plan');
const A_FILE_IS_GONE = 'A file is no longer there. Remove it and try again.';
const AT_MOST_10 = 'A message can have at most 10 files';
const NEEDS_TEXT_OR_FILE =
  'A message needs text or at least one file. Delete the message instead.';
const NOT_ALLOWED =
  'Only the person who added a file or a project admin can remove it';

describe('Files on messages (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    delete process.env['FILE_SIZE_LIMIT_MB'];
    expect(
      process.env['S3_BUCKET'],
      'the API must use TEST_S3_BUCKET, not the development bucket',
    ).toBe(testBucket());
    ({ app, prisma } = await startLiveApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await emptyBucket();
  });

  afterEach(() => {
    closeAllSockets();
  });

  afterAll(async () => {
    await app.close();
  });

  const setUp = () => messageFileScenario(app);

  async function fileRows(): Promise<number> {
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM files`;
    return Number(rows[0]!.n);
  }

  async function messageList(
    who: { agent: { get: (url: string) => request.Test } },
    chatId: string,
  ): Promise<MessageJson[]> {
    return (await who.agent.get(`/api/chats/${chatId}/messages`).expect(200))
      .body.messages as MessageJson[];
  }

  describe('uploading to the message box (criterion 4)', () => {
    // 4
    it('stores a pending file from any member and answers 201 with the file', async () => {
      const { cara, general } = await setUp();

      const response = await uploadToChat(cara.agent, general.id, {
        filename: 'plan.pdf',
        data: PDF,
        contentType: 'application/pdf',
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'plan.pdf',
        size: PDF.length,
        isImage: false,
        uploader: { id: cara.user.id, displayName: 'cara' },
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
        messageId: null,
        chatId: general.id,
        pending: true,
      });
      expect(await listKeys()).toHaveLength(1);
    });

    // 4
    it('stores an upload in a card’s own chat too', async () => {
      const { ana, cardChat } = await setUp();

      const response = await uploadToChat(ana.agent, cardChat.id, {
        filename: 'plan.pdf',
        data: PDF,
      }).expect(201);

      expect(response.body).toMatchObject({
        chatId: cardChat.id,
        pending: true,
      });
    });

    // 4 (a file on a card now says it is not pending)
    it('says pending: false for a file on a card', async () => {
      const { ana, card } = await setUp();

      const response = await upload(ana.agent, card.id, {
        filename: 'plan.pdf',
        data: PDF,
      }).expect(201);

      expect(response.body).toMatchObject({ pending: false });
    });

    // 4
    it('sends no live signal', async () => {
      const { ana, cara, board, general } = await setUp();
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      expect(await join(anaLive, board.id)).toBe(true);
      expect(await join(caraLive, board.id)).toBe(true);

      await uploadToChat(cara.agent, general.id, {
        filename: 'plan.pdf',
        data: PDF,
      })
        .set(LIVE_HEADER, caraLive.id)
        .expect(201);
      await quiet();

      expect(anaLive.signals).toEqual([]);
      expect(caraLive.signals).toEqual([]);
    });
  });

  describe('the same refusals as on a card (criterion 5)', () => {
    async function nothingKept() {
      expect(await listKeys()).toEqual([]);
      expect(await fileRows()).toBe(0);
    }

    // 5
    it('gives someone not signed in 401 and stores nothing', async () => {
      const { general } = await setUp();

      await request(app.getHttpServer())
        .post(`/api/chats/${general.id}/files`)
        .set('Content-Type', 'multipart/form-data; boundary=x')
        .send(Buffer.from('x'))
        .expect(401);

      await nothingKept();
    });

    // 5
    it('gives a non-member and an unknown chat 404 "Chat not found" and stores nothing', async () => {
      const { ben, general } = await setUp();

      const outsider = await uploadToChat(ben.agent, general.id, {
        filename: 'a.pdf',
        data: PDF,
      }).expect(404);
      const unknown = await uploadToChat(ben.agent, UNKNOWN_ID, {
        filename: 'a.pdf',
        data: PDF,
      }).expect(404);

      expect(String(outsider.body.message)).toContain('Chat not found');
      expect(String(unknown.body.message)).toContain('Chat not found');
      await nothingKept();
    });

    // 5
    it('refuses a request with no file, saying "Attach one file"', async () => {
      const { ana, general } = await setUp();

      for (const parts of [
        [],
        [{ field: 'upload', filename: 'plan.pdf', data: PDF }],
      ]) {
        const response = await uploadPartsToChat(
          ana.agent,
          general.id,
          parts,
        ).expect(400);
        expect(String(response.body.message)).toContain('Attach one file');
      }
      await nothingKept();
    });

    // 5
    it('refuses two files, saying "Attach one file at a time", and stores neither', async () => {
      const { ana, general } = await setUp();

      const response = await uploadPartsToChat(ana.agent, general.id, [
        part('one.pdf', PDF),
        part('two.pdf', PDF),
      ]).expect(400);

      expect(String(response.body.message)).toContain(
        'Attach one file at a time',
      );
      await nothingKept();
    });

    // 5
    it('keeps the name rules: the folder part goes, a NUL is refused with the app’s message, 256 characters are refused', async () => {
      const { ana, general } = await setUp();

      const tidy = await uploadToChat(ana.agent, general.id, {
        filename: 'C:\\Users\\jon\\plan.pdf',
        data: PDF,
      }).expect(201);
      expect(tidy.body.name).toBe('plan.pdf');
      const kept = (await listKeys()).length;

      const nul = await uploadToChat(ana.agent, general.id, {
        filename: 'pl\u0000an.pdf',
        data: PDF,
      }).expect(400);
      expect(String(nul.body.message)).toContain(NUL_MESSAGE);
      await uploadToChat(ana.agent, general.id, {
        filename: `${'x'.repeat(256)}.pdf`,
        data: PDF,
      }).expect(400);
      await uploadToChat(ana.agent, general.id, {
        filename: '   ',
        data: PDF,
      }).expect(400);

      expect(await listKeys()).toHaveLength(kept);
      expect(await fileRows()).toBe(1);
    });

    // 5
    it('refuses a NUL in the form field name', async () => {
      const { ana, general } = await setUp();

      await uploadPartsToChat(ana.agent, general.id, [
        { field: 'fi\u0000le', filename: 'plan.pdf', data: PDF },
      ]).expect(400);

      await nothingKept();
    });

    // 5
    it('decides from the first bytes whether the file is an image', async () => {
      const { ana, general } = await setUp();

      const png = await uploadToChat(ana.agent, general.id, {
        filename: 'notes.txt',
        data: PNG_BYTES,
        contentType: 'text/plain',
      }).expect(201);
      const svg = await uploadToChat(ana.agent, general.id, {
        filename: 'logo.png',
        data: SVG_BYTES,
        contentType: 'image/png',
      }).expect(201);
      const html = await uploadToChat(ana.agent, general.id, {
        filename: 'photo.png',
        data: HTML_BYTES,
        contentType: 'image/png',
      }).expect(201);

      expect(png.body.isImage).toBe(true);
      expect(svg.body.isImage).toBe(false);
      expect(html.body.isImage).toBe(false);
      // The "image" that is really HTML never shows inline.
      await ana.agent.get(`/api/files/${html.body.id}/preview`).expect(404);
    });
  });

  describe('at most 10 pending files (criterion 6)', () => {
    // 6
    it('refuses an 11th pending file by the same person in the same chat with 409, and keeps nothing', async () => {
      const { ana, general, pend } = await setUp();
      for (let i = 1; i <= 10; i++) await pend(ana, general.id, `f${i}.pdf`);

      const response = await uploadToChat(ana.agent, general.id, {
        filename: 'eleventh.pdf',
        data: PDF,
      }).expect(409);

      expect(String(response.body.message)).toContain(AT_MOST_10);
      expect(await listKeys()).toHaveLength(10);
      expect(await fileRows()).toBe(10);
    });

    // 6
    it('counts per person and per chat: another person, and the same person in another chat, can still upload', async () => {
      const { ana, cara, general, cardChat, pend } = await setUp();
      for (let i = 1; i <= 10; i++) await pend(ana, general.id, `f${i}.pdf`);

      await uploadToChat(cara.agent, general.id, {
        filename: 'cara.pdf',
        data: PDF,
      }).expect(201);
      await uploadToChat(ana.agent, cardChat.id, {
        filename: 'elsewhere.pdf',
        data: PDF,
      }).expect(201);
    });

    // 6
    it('counts only pending files: files already sent make room', async () => {
      const { ana, general, pend, sendWith } = await setUp();
      const first = [] as FileJson[];
      for (let i = 1; i <= 10; i++) {
        first.push(await pend(ana, general.id, `f${i}.pdf`));
      }
      await sendWith(
        ana,
        general.id,
        'Here',
        first.map((f) => f.id),
      );

      await uploadToChat(ana.agent, general.id, {
        filename: 'next.pdf',
        data: PDF,
      }).expect(201);
    });
  });

  describe('a pending file is seen only by its uploader (criterion 7)', () => {
    // 7
    it('gives another member, even a project admin, 404 "File not found" on download, preview and delete', async () => {
      const { ana, ben, cara, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'shot.png', PNG_BYTES);

      for (const who of [ana, ben]) {
        for (const path of ['download', 'preview']) {
          const response = await who.agent
            .get(`/api/files/${file.id}/${path}`)
            .expect(404);
          expect(String(response.body.message)).toContain('File not found');
        }
        const removal = await who.agent
          .delete(`/api/files/${file.id}`)
          .expect(404);
        expect(String(removal.body.message)).toContain('File not found');
      }
      // Nothing was removed.
      expect(await fileRows()).toBe(1);
      expect(await listKeys()).toHaveLength(1);
    });

    // 7
    it('lets the uploader download and preview their own pending file', async () => {
      const { cara, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'shot.png', PNG_BYTES);

      const download = await cara.agent
        .get(`/api/files/${file.id}/download`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(download.body).toEqual(PNG_BYTES);
      await cara.agent.get(`/api/files/${file.id}/preview`).expect(200);
    });

    // 7
    it('shows a pending file in no list: not the chat’s messages, not the card’s files', async () => {
      const { ana, cara, cardChat, card, pend } = await setUp();
      await pend(cara, cardChat.id, 'shot.png', PNG_BYTES);

      const messages = await messageList(ana, cardChat.id);
      const cardFiles = await ana.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);
      const caraCardFiles = await cara.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);

      expect(messages).toEqual([]);
      expect(cardFiles.body.files).toEqual([]);
      expect(caraCardFiles.body.files).toEqual([]);
    });
  });

  describe('removing a pending file (criterion 8)', () => {
    // 8
    it('lets the uploader remove it: 204, the row and the object are gone, no signal', async () => {
      const { ana, cara, board, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'plan.pdf');
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      expect(await join(anaLive, board.id)).toBe(true);
      expect(await join(caraLive, board.id)).toBe(true);
      expect(await listKeys()).toHaveLength(1);

      await cara.agent
        .delete(`/api/files/${file.id}`)
        .set(LIVE_HEADER, caraLive.id)
        .expect(204);
      await quiet();

      expect(await fileRows()).toBe(0);
      expect(await listKeys()).toEqual([]);
      expect(anaLive.signals).toEqual([]);
      expect(caraLive.signals).toEqual([]);
      await cara.agent.get(`/api/files/${file.id}/download`).expect(404);
    });
  });

  describe('sending a message with files (criteria 10 to 15)', () => {
    // 10
    it('saves the message and makes each pending file its file, in upload order', async () => {
      const { ana, cara, general, pend } = await setUp();
      const pdf = await pend(cara, general.id, 'plan.pdf', PDF);
      await quiet(20);
      const png = await pend(cara, general.id, 'shot.png', PNG_BYTES);

      const response = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Here you go', fileIds: [png.id, pdf.id] })
        .expect(201);

      // In the order of upload, not of the request.
      expect(response.body.files).toEqual([
        {
          ...pdf,
          messageId: response.body.id,
          chatId: general.id,
          pending: false,
        },
        {
          ...png,
          messageId: response.body.id,
          chatId: general.id,
          pending: false,
          isImage: true,
        },
      ]);
      // Seen by everyone, and no longer pending: Ana can download it.
      const download = await ana.agent
        .get(`/api/files/${pdf.id}/download`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(download.body).toEqual(PDF);
    });

    // 10
    it('sends a message with no fileIds as before, with files: []', async () => {
      const { cara, general } = await setUp();

      const plain = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Just text' })
        .expect(201);
      const empty = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Also text', fileIds: [] })
        .expect(201);

      expect(plain.body.files).toEqual([]);
      expect(empty.body.files).toEqual([]);
    });

    // 10
    it('gives the files in every message the API returns: the list, one message, an edit and a delete', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const file = await pend(cara, general.id, 'plan.pdf', PDF);
      const sent = await sendWith(cara, general.id, 'Here', [file.id]);
      const expected = [
        { ...file, messageId: sent.id, chatId: general.id, pending: false },
      ];

      const listed = await messageList(ana, general.id);
      const one = await ana.agent.get(`/api/messages/${sent.id}`).expect(200);
      const edited = await cara.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: 'Edited' })
        .expect(200);

      expect(listed[0]!.files).toEqual(expected);
      expect(one.body.files).toEqual(expected);
      expect(edited.body.files).toEqual(expected);
    });

    // 11
    it('refuses a fileIds entry that is not this person’s pending file in this chat with 400, and saves nothing, the message included', async () => {
      const { ana, cara, general, cardChat, pend, sendWith } = await setUp();
      const mine = await pend(cara, general.id, 'mine.pdf');
      const hers = await pend(ana, general.id, 'hers.pdf');
      const elsewhere = await pend(cara, cardChat.id, 'elsewhere.pdf');
      const sentFile = await pend(cara, general.id, 'sent.pdf');
      await sendWith(cara, general.id, 'Earlier', [sentFile.id]);
      const removed = await pend(cara, general.id, 'removed.pdf');
      await cara.agent.delete(`/api/files/${removed.id}`).expect(204);

      for (const bad of [
        hers.id,
        elsewhere.id,
        sentFile.id,
        removed.id,
        UNKNOWN_ID,
      ]) {
        const response = await cara.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ body: 'Never saved', fileIds: [mine.id, bad] })
          .expect(400);
        expect(String(response.body.message)).toContain(A_FILE_IS_GONE);
      }

      // Only the earlier message exists; the good file is still pending.
      const bodies = (await messageList(cara, general.id)).map((m) => m.body);
      expect(bodies).toEqual(['Earlier']);
      expect(await messageList(cara, cardChat.id)).toEqual([]);
      const still = await cara.agent
        .get(`/api/files/${mine.id}/download`)
        .expect(200);
      expect(still.status).toBe(200);
      // Ana's pending file was not taken by Cara.
      await ana.agent.get(`/api/files/${hers.id}/download`).expect(200);
      await sendWith(ana, general.id, 'Mine after all', [hers.id]);
    });

    // 11
    it('refuses more than 10 file ids and a repeated id with 400', async () => {
      const { cara, general, pend } = await setUp();
      const ids: string[] = [];
      for (let i = 1; i <= 10; i++) {
        ids.push((await pend(cara, general.id, `f${i}.pdf`)).id);
      }

      const tooMany = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Too many', fileIds: [...ids, UNKNOWN_ID] })
        .expect(400);
      const twice = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Twice', fileIds: [ids[0], ids[0]] })
        .expect(400);

      expect(JSON.stringify(tooMany.body.message)).toContain(AT_MOST_10);
      expect(twice.status).toBe(400);
      expect(await messageList(cara, general.id)).toEqual([]);
    });

    // 12
    it('answers 200 with the saved message and its files when the same message is sent again, and changes nothing', async () => {
      const { cara, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'plan.pdf');
      const spare = await pend(cara, general.id, 'spare.pdf');
      const id = '3f2b8c1e-9d4a-4f6b-8a1c-2e7d5b9a0c11';
      const first = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ id, body: 'Here', fileIds: [file.id] })
        .expect(201);

      for (const fileIds of [[file.id], [], [spare.id], [UNKNOWN_ID]]) {
        const again = await cara.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ id, body: 'Here', fileIds })
          .expect(200);
        expect(again.body).toEqual(first.body);
      }

      expect(await messageList(cara, general.id)).toHaveLength(1);
      // The spare file was not attached by a repeat.
      await cara.agent.get(`/api/files/${spare.id}/download`).expect(200);
      const rows = await prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM files WHERE message_id IS NOT NULL`;
      expect(Number(rows[0]!.n)).toBe(1);
    });

    // 13
    it('lets the text be blank when there is a file, and trims it', async () => {
      const { cara, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'plan.pdf');

      const response = await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: '   ', fileIds: [file.id] })
        .expect(201);

      expect(response.body.body).toBe('');
      expect(response.body.files).toHaveLength(1);
    });

    // 13
    it('still refuses blank text with no file', async () => {
      const { cara, general } = await setUp();

      for (const send of [{ body: '   ' }, { body: '', fileIds: [] }]) {
        const response = await cara.agent
          .post(`/api/chats/${general.id}/messages`)
          .send(send)
          .expect(400);
        // Jon, 2026-11-25: the shared rule's words.
        expect(JSON.stringify(response.body.message)).toContain(
          'Write a message or attach a file',
        );
      }
      expect(await messageList(cara, general.id)).toEqual([]);
    });

    // 14
    it('lets one of two sends at once, naming the same pending file, save, and refuses the other with 400', async () => {
      const { cara, general, pend } = await setUp();
      const file = await pend(cara, general.id, 'plan.pdf');
      // The same person in two tabs.
      const other = request.agent(app.getHttpServer());
      await other
        .post('/api/auth/sign-in')
        .send({ email: 'cara@example.com', password: 'a long enough password' })
        .expect(200);

      const [one, two] = await Promise.all(
        [cara.agent, other].map((agent) =>
          agent
            .post(`/api/chats/${general.id}/messages`)
            .send({ body: 'Same file', fileIds: [file.id] }),
        ),
      );

      expect([one.status, two.status].sort((a, b) => a - b)).toEqual([
        201, 400,
      ]);
      const refused = one.status === 400 ? one : two;
      expect(String(refused.body.message)).toContain(A_FILE_IS_GONE);
      const messages = await messageList(cara, general.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.files).toHaveLength(1);
    });

    // 15
    it('sends a message signal, and a card signal when the chat is a card’s chat', async () => {
      const { ana, cara, board, card, cardChat, general, pend, sendWith } =
        await setUp();
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      expect(await join(anaLive, board.id)).toBe(true);
      expect(await join(caraLive, board.id)).toBe(true);
      const inCard = await pend(cara, cardChat.id, 'plan.pdf');
      const inGeneral = await pend(cara, general.id, 'other.pdf');

      await cara.agent
        .post(`/api/chats/${cardChat.id}/messages`)
        .set(LIVE_HEADER, caraLive.id)
        .send({ body: 'In the card', fileIds: [inCard.id] })
        .expect(201);
      await until(
        () =>
          anaLive.signals.some(
            (s) => s.type === 'card' && s.cardId === card.id,
          ),
        'the card signal',
      );
      await quiet();

      const types = (live: LiveClient) =>
        live.signals.map((s) => s.type).sort();
      expect(types(anaLive)).toEqual(['card', 'message']);
      expect(anaLive.signals.find((s) => s.type === 'message')).toMatchObject({
        chatId: cardChat.id,
        boardId: board.id,
      });
      expect(caraLive.signals).toEqual([]);

      anaLive.signals.length = 0;
      await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .set(LIVE_HEADER, caraLive.id)
        .send({ body: 'In general', fileIds: [inGeneral.id] })
        .expect(201);
      await until(() => anaLive.signals.length > 0, 'the message signal');
      await quiet();
      expect(types(anaLive)).toEqual(['message']);
      void sendWith;
    });
  });

  describe('listing, editing and deleting messages (criteria 16 to 21)', () => {
    // 16
    it('includes each message’s files in the list and in one message, empty for a message with none', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const b = await pend(cara, general.id, 'b.pdf');
      const c = await pend(ana, general.id, 'c.pdf');
      const first = await sendWith(cara, general.id, 'One', [a.id, b.id]);
      await quiet(20);
      await cara.agent
        .post(`/api/chats/${general.id}/messages`)
        .send({ body: 'Two, no files' })
        .expect(201);
      await quiet(20);
      const third = await sendWith(ana, general.id, 'Three', [c.id]);

      const listed = await messageList(ana, general.id);

      expect(listed.map((m) => m.files.map((f) => f.name))).toEqual([
        ['a.pdf', 'b.pdf'],
        [],
        ['c.pdf'],
      ]);
      const one = await ana.agent.get(`/api/messages/${first.id}`).expect(200);
      expect(one.body.files.map((f: FileJson) => f.id)).toEqual([a.id, b.id]);
      const three = await cara.agent
        .get(`/api/messages/${third.id}`)
        .expect(200);
      expect(three.body.files).toHaveLength(1);
    });

    // 17
    it('removes a message’s files with the message: rows, then objects, answering files: []', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const b = await pend(cara, general.id, 'b.pdf');
      const other = await pend(ana, general.id, 'other.pdf');
      const sent = await sendWith(cara, general.id, 'Mine', [a.id, b.id]);
      await sendWith(ana, general.id, 'Ana’s', [other.id]);
      expect(await listKeys()).toHaveLength(3);

      const response = await cara.agent
        .delete(`/api/messages/${sent.id}`)
        .expect(200);

      expect(response.body.files).toEqual([]);
      expect(response.body.deletedAt).not.toBeNull();
      expect(response.body.body).toBe('Mine');
      expect(await listKeys()).toHaveLength(1);
      expect(await fileRows()).toBe(1);
      await ana.agent.get(`/api/files/${a.id}/download`).expect(404);
      await ana.agent.get(`/api/files/${other.id}/download`).expect(200);
      const listed = await messageList(ana, general.id);
      expect(listed[0]!.files).toEqual([]);
      expect(listed[0]!.body).toBe('Mine');
    });

    // 17
    it('lets a project admin delete someone else’s message, with its files', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const sent = await sendWith(cara, general.id, 'Mine', [a.id]);

      await ana.agent.delete(`/api/messages/${sent.id}`).expect(200);

      expect(await listKeys()).toEqual([]);
      expect(await fileRows()).toBe(0);
    });

    // 17
    it('does not delete the files when the delete is refused', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const a = await pend(ana, general.id, 'a.pdf');
      const sent = await sendWith(ana, general.id, 'Ana’s', [a.id]);

      await cara.agent.delete(`/api/messages/${sent.id}`).expect(403);

      expect(await listKeys()).toHaveLength(1);
      expect(await fileRows()).toBe(1);
    });

    // 18
    it('lets the uploader remove a message file: 204, row then object, no Activity line, message and card signals', async () => {
      const { ana, cara, board, card, cardChat, pend, sendWith } =
        await setUp();
      const a = await pend(cara, cardChat.id, 'a.pdf');
      const b = await pend(cara, cardChat.id, 'b.pdf');
      const sent = await sendWith(cara, cardChat.id, 'Two files', [a.id, b.id]);
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      expect(await join(anaLive, board.id)).toBe(true);
      expect(await join(caraLive, board.id)).toBe(true);
      anaLive.signals.length = 0;

      await cara.agent
        .delete(`/api/files/${a.id}`)
        .set(LIVE_HEADER, caraLive.id)
        .expect(204);
      await until(() => anaLive.signals.length >= 2, 'the two signals');
      await quiet();

      expect(await objectExists(await storageKeyOf(a.id))).toBe(false);
      const left = await ana.agent.get(`/api/messages/${sent.id}`).expect(200);
      expect(left.body.files.map((f: FileJson) => f.id)).toEqual([b.id]);
      const activity = await ana.agent
        .get(`/api/cards/${card.id}/activity`)
        .expect(200);
      expect(
        activity.body.items.filter((l: { kind: string }) =>
          l.kind.startsWith('FILE_'),
        ),
      ).toEqual([]);
      expect(anaLive.signals.map((s) => s.type).sort()).toEqual([
        'card',
        'message',
      ]);
      expect(anaLive.signals.find((s) => s.type === 'message')).toMatchObject({
        chatId: cardChat.id,
        messageId: sent.id,
      });
    });

    async function storageKeyOf(fileId: string): Promise<string> {
      const rows = await prisma.$queryRaw<
        { storage_key: string }[]
      >`SELECT storage_key FROM files WHERE id = ${fileId}::uuid`;
      // Gone already: the key is not needed, ask the store for any key that
      // is no longer listed.
      return rows[0]?.storage_key ?? `files/${fileId}`;
    }

    // 18
    it('lets a project admin remove a file from someone else’s message, with a signal and no Activity line', async () => {
      const { ana, cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const b = await pend(cara, general.id, 'b.pdf');
      const sent = await sendWith(cara, general.id, 'Two', [a.id, b.id]);

      await ana.agent.delete(`/api/files/${a.id}`).expect(204);

      const left = await cara.agent.get(`/api/messages/${sent.id}`).expect(200);
      expect(left.body.files.map((f: FileJson) => f.id)).toEqual([b.id]);
      expect(await listKeys()).toHaveLength(1);
    });

    // 18
    it('refuses another member with 403 and keeps the file, and gives a non-member 404', async () => {
      const { ana, ben, cara, general, pend, sendWith } = await setUp();
      const a = await pend(ana, general.id, 'a.pdf');
      const b = await pend(ana, general.id, 'b.pdf');
      await sendWith(ana, general.id, 'Ana’s', [a.id, b.id]);

      const refused = await cara.agent.delete(`/api/files/${a.id}`).expect(403);
      const outsider = await ben.agent.delete(`/api/files/${a.id}`).expect(404);

      expect(String(refused.body.message)).toContain(NOT_ALLOWED);
      expect(String(outsider.body.message)).toContain('File not found');
      expect(await fileRows()).toBe(2);
      expect(await listKeys()).toHaveLength(2);
    });

    // 18 (risk 5): an admin removes a file but still cannot edit the text
    it('still gives a project admin 403 for editing someone else’s text', async () => {
      const { ana, cara, general, sendWith, pend } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const sent = await sendWith(cara, general.id, 'Mine', [a.id]);

      const response = await ana.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: 'Changed' })
        .expect(403);

      expect(String(response.body.message)).toContain(
        'Only the author can edit a message',
      );
    });

    // 19
    it('refuses removing the last file of a message with no text, with 400, and the file stays', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const b = await pend(cara, general.id, 'b.pdf');
      const sent = await sendWith(cara, general.id, '', [a.id, b.id]);
      await cara.agent.delete(`/api/files/${a.id}`).expect(204);

      const response = await cara.agent
        .delete(`/api/files/${b.id}`)
        .expect(400);

      expect(String(response.body.message)).toContain(NEEDS_TEXT_OR_FILE);
      await cara.agent.get(`/api/files/${b.id}/download`).expect(200);
      const left = await cara.agent.get(`/api/messages/${sent.id}`).expect(200);
      expect(left.body.files).toHaveLength(1);
      expect(await listKeys()).toHaveLength(1);
    });

    // 19
    it('also refuses a project admin, and for a file of a card’s chat (the card’s Files section uses the same request)', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      const a = await pend(cara, cardChat.id, 'a.pdf');
      await sendWith(cara, cardChat.id, '  ', [a.id]);
      const listed = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(listed.body.files).toHaveLength(1);

      const response = await ana.agent.delete(`/api/files/${a.id}`).expect(400);

      expect(String(response.body.message)).toContain(NEEDS_TEXT_OR_FILE);
      expect(await fileRows()).toBe(1);
    });

    // 19
    it('lets the last file go when the message has text', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const sent = await sendWith(cara, general.id, 'Has text', [a.id]);

      await cara.agent.delete(`/api/files/${a.id}`).expect(204);

      const left = await cara.agent.get(`/api/messages/${sent.id}`).expect(200);
      expect(left.body.files).toEqual([]);
    });

    // 20
    it('lets one of two removals of the last two files of a message with no text through, and refuses the other with 400', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      for (let round = 0; round < 3; round++) {
        const a = await pend(cara, general.id, `a${round}.pdf`);
        const b = await pend(cara, general.id, `b${round}.pdf`);
        const sent = await sendWith(cara, general.id, '', [a.id, b.id]);

        const [one, two] = await Promise.all([
          cara.agent.delete(`/api/files/${a.id}`),
          cara.agent.delete(`/api/files/${b.id}`),
        ]);

        expect([one.status, two.status].sort((a, b) => a - b)).toEqual([
          204, 400,
        ]);
        const refused = one.status === 400 ? one : two;
        expect(String(refused.body.message)).toContain(NEEDS_TEXT_OR_FILE);
        const left = await cara.agent
          .get(`/api/messages/${sent.id}`)
          .expect(200);
        expect(left.body.files).toHaveLength(1);
      }
    });

    // 20
    it('ends cleanly when a message is deleted while one of its files is removed: no 500 and no file left', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      for (let round = 0; round < 4; round++) {
        const a = await pend(cara, general.id, `a${round}.pdf`);
        const b = await pend(cara, general.id, `b${round}.pdf`);
        const sent = await sendWith(cara, general.id, 'Text', [a.id, b.id]);

        const [message, file] = await Promise.all([
          cara.agent.delete(`/api/messages/${sent.id}`),
          cara.agent.delete(`/api/files/${a.id}`),
        ]);

        expect(message.status).toBe(200);
        expect([204, 404]).toContain(file.status);
      }
      expect(await fileRows()).toBe(0);
      expect(await listKeys()).toEqual([]);
    });

    // 20
    it('never leaves a message with neither text nor files when the text is edited to blank while the last file is removed', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      for (let round = 0; round < 6; round++) {
        const a = await pend(cara, general.id, `a${round}.pdf`);
        const sent = await sendWith(cara, general.id, 'Text', [a.id]);

        const [edit, removal] = await Promise.all([
          cara.agent.patch(`/api/messages/${sent.id}`).send({ body: '' }),
          cara.agent.delete(`/api/files/${a.id}`),
        ]);

        expect([edit.status, removal.status]).not.toContain(500);
        const now = await cara.agent
          .get(`/api/messages/${sent.id}`)
          .expect(200);
        expect(
          now.body.body.trim() !== '' || now.body.files.length > 0,
          `round ${round}: edit ${edit.status}, removal ${removal.status}`,
        ).toBe(true);
      }
    });

    // 21
    it('never changes a message’s files when its text is edited', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const b = await pend(cara, general.id, 'b.pdf');
      const sent = await sendWith(cara, general.id, 'Text', [a.id, b.id]);

      const edited = await cara.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: 'New text' })
        .expect(200);

      expect(edited.body.body).toBe('New text');
      expect(edited.body.files.map((f: FileJson) => f.id)).toEqual([
        a.id,
        b.id,
      ]);
    });

    // 21
    it('refuses file fields in an edit with 400', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const spare = await pend(cara, general.id, 'spare.pdf');
      const sent = await sendWith(cara, general.id, 'Text', [a.id]);

      await cara.agent
        .patch(`/api/messages/${sent.id}`)
        .send({ body: 'Text', fileIds: [spare.id] })
        .expect(400);

      const now = await cara.agent.get(`/api/messages/${sent.id}`).expect(200);
      expect(now.body.files).toHaveLength(1);
    });

    // 21
    it('allows editing the text to blank only while the message has files', async () => {
      const { cara, general, pend, sendWith } = await setUp();
      const a = await pend(cara, general.id, 'a.pdf');
      const withFile = await sendWith(cara, general.id, 'Text', [a.id]);
      const without = (
        await cara.agent
          .post(`/api/chats/${general.id}/messages`)
          .send({ body: 'No files' })
          .expect(201)
      ).body as MessageJson;

      const blanked = await cara.agent
        .patch(`/api/messages/${withFile.id}`)
        .send({ body: '   ' })
        .expect(200);
      await cara.agent
        .patch(`/api/messages/${without.id}`)
        .send({ body: '   ' })
        .expect(400);

      expect(blanked.body.body).toBe('');
      expect(blanked.body.files).toHaveLength(1);
      const unchanged = await cara.agent
        .get(`/api/messages/${without.id}`)
        .expect(200);
      expect(unchanged.body.body).toBe('No files');
    });
  });

  describe('the card’s Files section, "from chat" (criteria 22 and 23)', () => {
    // 22
    it('lists the files of the card’s chat with the card’s own, newest first, never pending ones', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      const own = (
        await upload(ana.agent, card.id, {
          filename: 'own.pdf',
          data: PDF,
        }).expect(201)
      ).body as FileJson;
      await quiet(20);
      const chatFile = await pend(cara, cardChat.id, 'chat.pdf');
      const sent = await sendWith(cara, cardChat.id, 'Look', [chatFile.id]);
      await pend(cara, cardChat.id, 'pending.pdf');

      const list = await ana.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);

      expect(
        list.body.files.map((f: FileJson) => [f.name, f.messageId, f.chatId]),
      ).toEqual([
        ['chat.pdf', sent.id, cardChat.id],
        ['own.pdf', null, null],
      ]);
      expect(list.body.files[1].id).toBe(own.id);
    });

    // 22
    it('does not list the files of a general chat on any card', async () => {
      const { ana, cara, card, general, pend, sendWith } = await setUp();
      const f = await pend(cara, general.id, 'general.pdf');
      await sendWith(cara, general.id, 'Hi', [f.id]);

      const list = await ana.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);

      expect(list.body.files).toEqual([]);
    });

    // 22
    it('drops a chat’s files from the card’s list when the chat is unlinked, and shows them on the card it is linked to next', async () => {
      const { ana, cara, card, cardChat, newCard, pend, sendWith } =
        await setUp();
      const f = await pend(cara, cardChat.id, 'chat.pdf');
      await sendWith(cara, cardChat.id, 'Look', [f.id]);
      const other = await newCard('Other');
      await ana.agent.delete(`/api/chats/${cardChat.id}/card`).expect(200);
      // A new card has its own chat; unlink it to make room.
      const otherChat = (await ana.agent.get(`/api/cards/${other.id}`)).body
        .chat as { id: string };
      await ana.agent.delete(`/api/chats/${otherChat.id}/card`).expect(200);

      const unlinked = await ana.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);
      await ana.agent
        .put(`/api/chats/${cardChat.id}/card`)
        .send({ cardId: other.id })
        .expect(200);
      const linked = await ana.agent
        .get(`/api/cards/${other.id}/files`)
        .expect(200);
      const first = await ana.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);

      expect(unlinked.body.files).toEqual([]);
      expect(linked.body.files.map((x: FileJson) => x.name)).toEqual([
        'chat.pdf',
      ]);
      expect(first.body.files).toEqual([]);
    });

    // 23
    it('counts only the card’s own files when deleting: a card with only chat files needs no choice, and its chat files stay in the chat', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      const f = await pend(cara, cardChat.id, 'chat.pdf');
      const sent = await sendWith(cara, cardChat.id, 'Look', [f.id]);

      await ana.agent.delete(`/api/cards/${card.id}`).expect(204);

      const messages = await messageList(ana, cardChat.id);
      expect(messages.map((m) => m.id)).toEqual([sent.id]);
      expect(messages[0]!.files.map((x) => x.id)).toEqual([f.id]);
      await ana.agent.get(`/api/files/${f.id}/download`).expect(200);
      expect(await listKeys()).toHaveLength(1);
    });

    // 23
    it('with files=delete removes only the card’s own files, never the chat’s', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      await upload(ana.agent, card.id, {
        filename: 'own.pdf',
        data: PDF,
      }).expect(201);
      const f = await pend(cara, cardChat.id, 'chat.pdf');
      await sendWith(cara, cardChat.id, 'Look', [f.id]);

      await ana.agent
        .delete(`/api/cards/${card.id}?files=delete`)
        .send({ filesSeen: 1 })
        .expect(204);

      expect(await fileRows()).toBe(1);
      await ana.agent.get(`/api/files/${f.id}/download`).expect(200);
    });

    // 23
    it('still asks for a choice when the card has its own file as well as chat files', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      await upload(ana.agent, card.id, {
        filename: 'own.pdf',
        data: PDF,
      }).expect(201);
      const f = await pend(cara, cardChat.id, 'chat.pdf');
      await sendWith(cara, cardChat.id, 'Look', [f.id]);

      const response = await ana.agent.delete(`/api/cards/${card.id}`);

      expect(response.status).toBe(400);
      expect(String(response.body.message)).toContain(
        'Choose what happens to this card’s files',
      );
      expect(await fileRows()).toBe(2);
    });

    // 25 (the refusal of a removal from the card’s Files section is the same
    // request as in the chat)
    it('lets the uploader or a project admin remove a chat file through the card’s list, with no Activity line', async () => {
      const { ana, cara, card, cardChat, pend, sendWith } = await setUp();
      const a = await pend(cara, cardChat.id, 'a.pdf');
      const b = await pend(cara, cardChat.id, 'b.pdf');
      await sendWith(cara, cardChat.id, 'Look', [a.id, b.id]);
      const listed = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(listed.body.files).toHaveLength(2);

      await cara.agent.delete(`/api/files/${a.id}`).expect(204);
      await ana.agent.delete(`/api/files/${b.id}`).expect(204);

      const after = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(after.body.files).toEqual([]);
      const activity = await ana.agent.get(`/api/cards/${card.id}/activity`);
      expect(
        activity.body.items.filter((l: { kind: string }) =>
          l.kind.startsWith('FILE_'),
        ),
      ).toEqual([]);
    });
  });

  // A last check that the bytes of a stored message file are the real ones.
  it('keeps the exact bytes of a sent file in the store', async () => {
    const { cara, general, pend, sendWith } = await setUp();
    const f = await pend(cara, general.id, 'plan.pdf', PDF);
    await sendWith(cara, general.id, 'Here', [f.id]);

    const [key] = await listKeys();

    expect(await getObject(key!)).toEqual(PDF);
  });
});
