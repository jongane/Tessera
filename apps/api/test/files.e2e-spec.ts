import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { NUL_MESSAGE } from '@tessera/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import {
  fileScenario,
  part,
  upload,
  uploadParts,
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
import {
  GIF_BYTES,
  HTML_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  SVG_BYTES,
  WEBP_BYTES,
} from './support/multipart.js';
import {
  emptyBucket,
  getObject,
  listKeys,
  objectExists,
  seedFile,
  testBucket,
} from './support/storage.js';

// Files on cards, PR A (plan "file storage and files on cards"): the five
// file endpoints against real PostgreSQL and real SeaweedFS (acceptance
// criteria 5, 12 to 27 and 31). The size limit and the bucket are in
// files-limit.e2e-spec.ts and files-bucket.e2e-spec.ts; storage that fails is
// in files-storage-failures.e2e-spec.ts.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const byText = (
  a: string | number | undefined,
  b: string | number | undefined,
) => String(a).localeCompare(String(b));
const PDF = Buffer.from('%PDF-1.7 pretend this is a plan');

describe('Files on cards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    // These tests run with the default limit and the tests' own bucket.
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

  const setUp = () => fileScenario(app);

  // Ana attaches `name` to the scenario's card; the file as the API gives it.
  async function attach(
    who: { agent: Parameters<typeof upload>[0] },
    cardId: string,
    name: string,
    data: Buffer | string = PDF,
    contentType?: string,
  ) {
    const response = await upload(who.agent, cardId, {
      filename: name,
      data,
      contentType,
    }).expect(201);
    return response.body as {
      id: string;
      name: string;
      size: number;
      isImage: boolean;
      uploader: { id: string; displayName: string } | null;
      createdAt: string;
      messageId: string | null;
      chatId: string | null;
    };
  }

  describe('the server settings (criterion 5)', () => {
    // 5
    it('tell the largest file in bytes, to anyone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/server/settings')
        .expect(200);

      expect(response.body).toMatchObject({
        signUpOpen: true,
        fileSizeLimitBytes: 100 * 1024 * 1024,
      });
    });
  });

  describe('attaching (criteria 12 to 17)', () => {
    // 12
    it('stores a file from any member and answers 201 with the file', async () => {
      const { cara, card } = await setUp();

      const response = await upload(cara.agent, card.id, {
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
        chatId: null,
      });
      const keys = await listKeys();
      expect(keys).toHaveLength(1);
      // The key is random, never made from the file's name.
      expect(keys[0]).toMatch(/^files\/[0-9a-f-]{36}$/);
      await expect(getObject(keys[0]!)).resolves.toEqual(PDF);
    });

    // 12
    it('stores an empty file too', async () => {
      const { ana, card } = await setUp();

      const file = await attach(ana, card.id, 'empty.txt', Buffer.alloc(0));

      expect(file.size).toBe(0);
    });

    // 13
    it('gives a non-member 404 "Card not found" and stores nothing', async () => {
      const { ben, card } = await setUp();

      const response = await upload(ben.agent, card.id, {
        filename: 'plan.pdf',
        data: PDF,
      }).expect(404);

      expect(String(response.body.message)).toContain('Card not found');
      expect(await listKeys()).toEqual([]);
    });

    // 13
    it('gives an unknown card 404 "Card not found" and stores nothing', async () => {
      const { ana } = await setUp();

      const response = await upload(ana.agent, UNKNOWN_ID, {
        filename: 'plan.pdf',
        data: PDF,
      }).expect(404);

      expect(String(response.body.message)).toContain('Card not found');
      expect(await listKeys()).toEqual([]);
    });

    // 13
    it('gives someone not signed in 401 and stores nothing', async () => {
      const { card } = await setUp();
      const { body, contentType } = {
        body: Buffer.from('x'),
        contentType: 'multipart/form-data; boundary=x',
      };

      await request(app.getHttpServer())
        .post(`/api/cards/${card.id}/files`)
        .set('Content-Type', contentType)
        .send(body)
        .expect(401);

      expect(await listKeys()).toEqual([]);
    });

    // 15
    it('refuses a request with no file, saying "Attach one file"', async () => {
      const { ana, card } = await setUp();

      for (const parts of [
        [],
        // A file under another field name is not "the file".
        [{ field: 'upload', filename: 'plan.pdf', data: PDF }],
      ]) {
        const response = await uploadParts(ana.agent, card.id, parts).expect(
          400,
        );
        expect(String(response.body.message)).toContain('Attach one file');
      }
      expect(await listKeys()).toEqual([]);
    });

    // 15
    it('refuses two files, saying "Attach one file at a time", and stores neither', async () => {
      const { ana, card } = await setUp();

      const response = await uploadParts(ana.agent, card.id, [
        part('one.pdf', PDF),
        part('two.pdf', PDF),
      ]).expect(400);

      expect(String(response.body.message)).toContain(
        'Attach one file at a time',
      );
      expect(await listKeys()).toEqual([]);
      const list = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(list.body.files).toEqual([]);
    });

    // 15
    it('refuses other form fields, and stores nothing', async () => {
      const { ana, card } = await setUp();

      await uploadParts(ana.agent, card.id, [
        part('plan.pdf', PDF),
        { field: 'cardId', data: UNKNOWN_ID },
      ]).expect(400);
      await uploadParts(ana.agent, card.id, [
        { field: 'note', data: 'hello' },
        part('plan.pdf', PDF),
      ]).expect(400);

      expect(await listKeys()).toEqual([]);
    });

    describe('the name (criterion 16)', () => {
      // 16
      it.each([
        ['C:\\Users\\jon\\plan.pdf', 'plan.pdf'],
        ['../plan.pdf', 'plan.pdf'],
        ['  plan.pdf ', 'plan.pdf'],
        ['Résumé 日本 🎉.pdf', 'Résumé 日本 🎉.pdf'],
        ['naïve café – 한국어.txt', 'naïve café – 한국어.txt'],
      ])('turns the browser’s name %j into %j', async (sent, stored) => {
        const { ana, card } = await setUp();

        const file = await attach(ana, card.id, sent);

        expect(file.name).toBe(stored);
        const list = await ana.agent.get(`/api/cards/${card.id}/files`);
        expect(list.body.files[0].name).toBe(stored);
      });

      // 16
      it('refuses a NUL character in the name with the app’s message', async () => {
        const { ana, card } = await setUp();

        const response = await upload(ana.agent, card.id, {
          filename: 'pl\u0000an.pdf',
          data: PDF,
        }).expect(400);

        expect(String(response.body.message)).toContain(NUL_MESSAGE);
        expect(await listKeys()).toEqual([]);
      });

      // 16
      it.each(['   ', '../'])('refuses the name %j as empty', async (sent) => {
        const { ana, card } = await setUp();

        const response = await upload(ana.agent, card.id, {
          filename: sent,
          data: PDF,
        }).expect(400);

        expect(String(response.body.message)).toContain('This can’t be empty');
        expect(await listKeys()).toEqual([]);
      });

      // 16
      it('refuses a name over 255 characters', async () => {
        const { ana, card } = await setUp();

        const response = await upload(ana.agent, card.id, {
          filename: `${'x'.repeat(256)}.txt`,
          data: PDF,
        }).expect(400);

        expect(String(response.body.message)).toContain(
          'Use at most 255 characters',
        );
        expect(await listKeys()).toEqual([]);
      });

      // 16 (the NUL rule covers the form field's name too)
      it('refuses a NUL character in the form field name', async () => {
        const { ana, card } = await setUp();

        await uploadParts(ana.agent, card.id, [
          { field: 'fi\u0000le', filename: 'plan.pdf', data: PDF },
        ]).expect(400);

        expect(await listKeys()).toEqual([]);
      });
    });

    describe('image or not (criterion 17)', () => {
      // 17
      it.each([
        ['PNG', PNG_BYTES],
        ['JPEG', JPEG_BYTES],
        ['GIF', GIF_BYTES],
        ['WebP', WEBP_BYTES],
      ])(
        'says a %s is an image by its bytes, whatever name and type came with it',
        async (_kind, bytes) => {
          const { ana, card } = await setUp();

          const file = await attach(
            ana,
            card.id,
            'notes.txt',
            bytes,
            'text/plain',
          );

          expect(file.isImage).toBe(true);
        },
      );

      // 17
      it.each([
        ['an SVG', 'logo.svg', SVG_BYTES, 'image/svg+xml'],
        ['an HTML file renamed x.png', 'x.png', HTML_BYTES, 'image/png'],
        [
          'text sent as image/png',
          'photo.png',
          Buffer.from('just words'),
          'image/png',
        ],
        [
          'HTML after a GIF-looking name',
          'pic.gif',
          Buffer.from('<html>GIF89a'),
          'image/gif',
        ],
      ])('says %s is not an image', async (_what, name, bytes, type) => {
        const { ana, card } = await setUp();

        const file = await attach(ana, card.id, name, bytes, type);

        expect(file.isImage).toBe(false);
      });
    });
  });

  describe('Activity and live signals (criteria 18 and 19)', () => {
    // 18
    it('adds a FILE_ADDED line with the file’s id, name and size', async () => {
      const { ana, card } = await setUp();

      const file = await attach(ana, card.id, 'plan.pdf');

      const activity = await ana.agent
        .get(`/api/cards/${card.id}/activity`)
        .expect(200);
      expect(activity.body.items[0]).toMatchObject({
        kind: 'FILE_ADDED',
        details: { fileId: file.id, name: 'plan.pdf', size: PDF.length },
        actor: { id: ana.user.id, displayName: 'ana' },
      });
    });

    // 18
    it('adds no line when the upload is refused', async () => {
      const { ana, ben, card } = await setUp();

      await upload(ben.agent, card.id, { filename: 'a.pdf', data: PDF }).expect(
        404,
      );
      await upload(ana.agent, card.id, {
        filename: `${'x'.repeat(256)}.pdf`,
        data: PDF,
      }).expect(400);

      const activity = await ana.agent.get(`/api/cards/${card.id}/activity`);
      expect(
        activity.body.items.filter(
          (line: { kind: string }) => line.kind === 'FILE_ADDED',
        ),
      ).toEqual([]);
    });

    async function twoLive() {
      const scenario = await setUp();
      const anaLive = await connect(app, cookieOf(scenario.ana.agent));
      const caraLive = await connect(app, cookieOf(scenario.cara.agent));
      expect(await join(anaLive, scenario.board.id)).toBe(true);
      expect(await join(caraLive, scenario.board.id)).toBe(true);
      return { ...scenario, anaLive, caraLive };
    }

    function cardSignals(who: LiveClient, cardId: string) {
      return who.signals.filter(
        (s) => s.type === 'card' && s.cardId === cardId,
      );
    }

    // 19
    it('sends a card signal to the board’s room when a file is attached', async () => {
      const { ana, card, board, anaLive, caraLive } = await twoLive();

      await upload(ana.agent, card.id, { filename: 'plan.pdf', data: PDF })
        .set(LIVE_HEADER, anaLive.id)
        .expect(201);

      await until(
        () => cardSignals(caraLive, card.id).length > 0,
        'the card signal',
      );
      expect(cardSignals(caraLive, card.id)[0]).toMatchObject({
        type: 'card',
        cardId: card.id,
        boardId: board.id,
      });
    });

    // 19
    it('sends no signal for a refused upload', async () => {
      const { ana, card, caraLive } = await twoLive();

      await upload(ana.agent, card.id, {
        filename: `${'x'.repeat(256)}.pdf`,
        data: PDF,
      }).expect(400);
      await uploadParts(ana.agent, card.id, []).expect(400);
      await quiet();

      expect(caraLive.signals).toEqual([]);
    });
  });

  describe('listing (criterion 20)', () => {
    // 20
    it('lists a card’s files newest first, for members only', async () => {
      const { ana, cara, ben, card } = await setUp();
      const first = await attach(ana, card.id, 'first.pdf');
      await quiet(20);
      const second = await attach(cara, card.id, 'second.pdf');
      await quiet(20);
      const third = await attach(ana, card.id, 'third.pdf');

      const list = await cara.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(200);

      expect(list.body.files.map((f: { id: string }) => f.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
      expect(list.body.files[1]).toMatchObject({
        name: 'second.pdf',
        size: PDF.length,
        isImage: false,
        uploader: { id: cara.user.id, displayName: 'cara' },
        messageId: null,
        chatId: null,
      });
      const again = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(again.body).toEqual(list.body);
      const refused = await ben.agent
        .get(`/api/cards/${card.id}/files`)
        .expect(404);
      expect(String(refused.body.message)).toContain('Card not found');
      await ana.agent.get(`/api/cards/${UNKNOWN_ID}/files`).expect(404);
    });

    // 20
    it('gives an empty list for a card with no files', async () => {
      const { ana, card } = await setUp();

      const list = await ana.agent.get(`/api/cards/${card.id}/files`);

      expect(list.body).toEqual({ files: [] });
    });

    // 20
    it('gives uploader null for a file whose uploader’s account was deleted', async () => {
      const { ana, cara, card } = await setUp();
      await attach(cara, card.id, 'plan.pdf');

      await prisma.user.delete({ where: { id: cara.user.id } });

      const list = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(list.body.files).toHaveLength(1);
      expect(list.body.files[0]).toMatchObject({
        name: 'plan.pdf',
        uploader: null,
      });
    });
  });

  describe('downloading (criterion 21)', () => {
    // 21
    it('gives the exact bytes as a download to a member', async () => {
      const { ana, cara, card } = await setUp();
      const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13, 65]);
      const file = await attach(ana, card.id, 'Résumé 日本 🎉.pdf', bytes);

      const response = await cara.agent
        .get(`/api/files/${file.id}/download`)
        .expect(200);

      expect(response.body).toEqual(bytes);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-length']).toBe(String(bytes.length));
      const disposition = String(response.headers['content-disposition']);
      expect(disposition).toMatch(/^attachment\s*;/);
      // An ASCII fallback, and the full name for browsers that read it.
      expect(disposition).toMatch(/filename="[\x20-\x7e]*"/);
      expect(disposition).toContain(
        "filename*=UTF-8''R%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC%20%F0%9F%8E%89.pdf",
      );
    });

    // 21
    it('downloads an image as a download too, never as an image', async () => {
      const { ana, card } = await setUp();
      const file = await attach(ana, card.id, 'photo.png', PNG_BYTES);

      const response = await ana.agent
        .get(`/api/files/${file.id}/download`)
        .expect(200);

      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(String(response.headers['content-disposition'])).toMatch(
        /^attachment/,
      );
    });

    // 21
    it('gives a non-member and an unknown id 404 "File not found", and a malformed id 400', async () => {
      const { ana, ben, card } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');

      const refused = await ben.agent
        .get(`/api/files/${file.id}/download`)
        .expect(404);
      const unknown = await ana.agent
        .get(`/api/files/${UNKNOWN_ID}/download`)
        .expect(404);
      await ana.agent.get('/api/files/not-an-id/download').expect(400);

      expect(String(refused.body.message)).toContain('File not found');
      expect(String(unknown.body.message)).toContain('File not found');
      await request(app.getHttpServer())
        .get(`/api/files/${file.id}/download`)
        .expect(401);
    });

    // 21 (risk 2: someone removed from the project loses access at once)
    it('stops serving a member who was removed from the project', async () => {
      const { ana, cara, card, project } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');
      await cara.agent.get(`/api/files/${file.id}/download`).expect(200);

      await ana.agent
        .delete(`/api/projects/${project.id}/members/${cara.user.id}`)
        .expect(204);

      await cara.agent.get(`/api/files/${file.id}/download`).expect(404);
      await cara.agent.get(`/api/files/${file.id}/preview`).expect(404);
    });
  });

  describe('previewing (criterion 22)', () => {
    // 22
    it.each([
      ['image/png', 'a.png', PNG_BYTES],
      ['image/jpeg', 'a.jpg', JPEG_BYTES],
      ['image/gif', 'a.gif', GIF_BYTES],
      ['image/webp', 'a.webp', WEBP_BYTES],
    ])(
      'shows a %s file inline with its detected type and safe headers',
      async (type, name, bytes) => {
        const { ana, cara, card } = await setUp();
        // The name and the type the browser sent say otherwise.
        const file = await attach(ana, card.id, name, bytes, 'text/html');

        const response = await cara.agent
          .get(`/api/files/${file.id}/preview`)
          .expect(200);

        expect(response.body).toEqual(bytes);
        expect(response.headers['content-type']).toBe(type);
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['content-security-policy']).toBe(
          "default-src 'none'; sandbox",
        );
        expect(
          String(response.headers['content-disposition'] ?? 'inline'),
        ).not.toMatch(/^attachment/);
      },
    );

    // 22
    it.each([
      ['an SVG', 'logo.svg', SVG_BYTES, 'image/svg+xml'],
      ['an HTML file named x.png', 'x.png', HTML_BYTES, 'image/png'],
      ['a PDF', 'plan.pdf', PDF, 'application/pdf'],
      ['text sent as image/png', 'p.png', Buffer.from('words'), 'image/png'],
    ])(
      'answers 404 "File not found" for %s',
      async (_what, name, bytes, type) => {
        const { ana, card } = await setUp();
        const file = await attach(ana, card.id, name, bytes, type);

        const response = await ana.agent
          .get(`/api/files/${file.id}/preview`)
          .expect(404);

        expect(String(response.body.message)).toContain('File not found');
        // It can still be downloaded.
        await ana.agent.get(`/api/files/${file.id}/download`).expect(200);
      },
    );

    // 22
    it('gives a non-member and an unknown id 404 "File not found"', async () => {
      const { ana, ben, card } = await setUp();
      const file = await attach(ana, card.id, 'a.png', PNG_BYTES);

      await ben.agent.get(`/api/files/${file.id}/preview`).expect(404);
      await ana.agent.get(`/api/files/${UNKNOWN_ID}/preview`).expect(404);
      await request(app.getHttpServer())
        .get(`/api/files/${file.id}/preview`)
        .expect(401);
    });

    // 22 (the stored type is the detected one, whatever the row says)
    it('does not show a file inline because its row says image', async () => {
      const { ana, project, card } = await setUp();
      const { id } = await seedFile(prisma, {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.user.id,
        name: 'x.png',
        bytes: HTML_BYTES,
        mimeType: 'application/octet-stream',
      });

      await ana.agent.get(`/api/files/${id}/preview`).expect(404);
    });
  });

  describe('names in response headers (criterion 23)', () => {
    // 23
    it.each([
      ['quotes', 'say "hi".txt'],
      ['semicolons', 'a; filename=evil.exe; x.txt'],
      ['new lines', 'line1\nline2.txt'],
      [
        'a carriage return and new line',
        'a\r\nX-Injected: yes\r\n\r\nbody.txt',
      ],
      ['a backslash and quote', 'back\\slash".txt'],
      ['a right-to-left override', 'photo\u202Egnp.exe'],
    ])('cannot be broken or added to by %s in a name', async (_what, name) => {
      const { ana, project, card } = await setUp();
      const bytes = Buffer.from('safe bytes');
      const { id } = await seedFile(prisma, {
        projectId: project.id,
        cardId: card.id,
        uploaderId: ana.user.id,
        name,
        bytes,
      });

      const response = await ana.agent
        .get(`/api/files/${id}/download`)
        .expect(200);

      expect(response.body).toEqual(bytes);
      expect(response.headers['x-injected']).toBeUndefined();
      const disposition = String(response.headers['content-disposition']);
      expect(disposition).not.toMatch(/[\r\n]/);
      expect(disposition).toMatch(/^attachment\s*;/);
      // The quoted fallback is one well-formed quoted string.
      expect(disposition).toMatch(/filename="(?:[^"\\]|\\.)*"/);
      const encoded = /filename\*=UTF-8''([^;]*)/.exec(disposition);
      expect(encoded, 'the full name is given as filename*').not.toBeNull();
      expect(decodeURIComponent(encoded![1]!)).toBe(name);
    });
  });

  describe('removing (criteria 24 to 27)', () => {
    // 24
    it('lets the uploader remove a file: row, Activity line and storage object', async () => {
      const { ana, cara, card } = await setUp();
      const file = await attach(cara, card.id, 'plan.pdf');
      const [key] = await listKeys();
      expect(await objectExists(key!)).toBe(true);

      await cara.agent.delete(`/api/files/${file.id}`).expect(204);

      const list = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(list.body.files).toEqual([]);
      expect(await objectExists(key!)).toBe(false);
      expect(await listKeys()).toEqual([]);
      const activity = await ana.agent.get(`/api/cards/${card.id}/activity`);
      expect(activity.body.items[0]).toMatchObject({
        kind: 'FILE_REMOVED',
        details: { fileId: file.id, name: 'plan.pdf', size: PDF.length },
        actor: { id: cara.user.id },
      });
      await ana.agent.get(`/api/files/${file.id}/download`).expect(404);
    });

    // 24
    it('lets a project admin remove another member’s file', async () => {
      const { ana, cara, card } = await setUp();
      const file = await attach(cara, card.id, 'plan.pdf');

      await ana.agent.delete(`/api/files/${file.id}`).expect(204);

      expect(await listKeys()).toEqual([]);
    });

    // 24 (risk 7: only the removed row's key is ever deleted)
    it('deletes only the removed file’s object', async () => {
      const { ana, card } = await setUp();
      const keep = await attach(ana, card.id, 'keep.pdf', Buffer.from('keep'));
      const gone = await attach(ana, card.id, 'gone.pdf', Buffer.from('gone'));

      await ana.agent.delete(`/api/files/${gone.id}`).expect(204);

      const keys = await listKeys();
      expect(keys).toHaveLength(1);
      await expect(getObject(keys[0]!)).resolves.toEqual(Buffer.from('keep'));
      await ana.agent.get(`/api/files/${keep.id}/download`).expect(200);
    });

    // 25
    it('refuses another member with 403 and keeps the file', async () => {
      const { ana, cara, card } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');

      const response = await cara.agent
        .delete(`/api/files/${file.id}`)
        .expect(403);

      expect(String(response.body.message)).toContain(
        'Only the person who added a file or a project admin can remove it',
      );
      expect(await listKeys()).toHaveLength(1);
      await ana.agent.get(`/api/files/${file.id}/download`).expect(200);
    });

    // 25
    it('gives a non-member and an unknown id 404 "File not found"', async () => {
      const { ana, ben, card } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');

      const refused = await ben.agent
        .delete(`/api/files/${file.id}`)
        .expect(404);
      const unknown = await ana.agent
        .delete(`/api/files/${UNKNOWN_ID}`)
        .expect(404);

      expect(String(refused.body.message)).toContain('File not found');
      expect(String(unknown.body.message)).toContain('File not found');
      expect(await listKeys()).toHaveLength(1);
      await request(app.getHttpServer())
        .delete(`/api/files/${file.id}`)
        .expect(401);
    });

    // 26
    it('lets a project admin remove a file whose uploader’s account was deleted', async () => {
      const { ana, cara, card } = await setUp();
      const file = await attach(cara, card.id, 'plan.pdf');
      await prisma.user.delete({ where: { id: cara.user.id } });

      await ana.agent.delete(`/api/files/${file.id}`).expect(204);

      expect(await listKeys()).toEqual([]);
    });

    // 27
    it('sends a card signal when a file is removed, and none when refused', async () => {
      const { ana, cara, card, board } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      await join(anaLive, board.id);
      await join(caraLive, board.id);

      await cara.agent
        .delete(`/api/files/${file.id}`)
        .set(LIVE_HEADER, caraLive.id)
        .expect(403);
      await ana.agent.delete(`/api/files/${UNKNOWN_ID}`).expect(404);
      await quiet();
      expect(anaLive.signals).toEqual([]);

      await ana.agent
        .delete(`/api/files/${file.id}`)
        .set(LIVE_HEADER, anaLive.id)
        .expect(204);

      await until(
        () =>
          caraLive.signals.some(
            (s) => s.type === 'card' && s.cardId === card.id,
          ),
        'the card signal',
      );
    });

    // 27
    it('removing twice at once gives one 204 and one 404, and one Activity line', async () => {
      const { ana, card } = await setUp();
      const file = await attach(ana, card.id, 'plan.pdf');

      const answers = await Promise.all([
        ana.agent.delete(`/api/files/${file.id}`),
        ana.agent.delete(`/api/files/${file.id}`),
      ]);

      expect(answers.map((a) => a.status).sort(byText)).toEqual([204, 404]);
      const activity = await ana.agent.get(`/api/cards/${card.id}/activity`);
      expect(
        activity.body.items.filter(
          (line: { kind: string }) => line.kind === 'FILE_REMOVED',
        ),
      ).toHaveLength(1);
      expect(await listKeys()).toEqual([]);
    });
  });

  describe('deleting a card that has files (criterion 31)', () => {
    async function withFiles() {
      const scenario = await setUp();
      const { ana, card } = scenario;
      const one = await attach(ana, card.id, 'one.pdf', Buffer.from('one'));
      await quiet(20);
      const two = await attach(ana, card.id, 'two.pdf', Buffer.from('two'));
      return { ...scenario, one, two };
    }

    // 31
    it('deletes the files too when files=delete is given: rows and storage objects', async () => {
      const { ana, card } = await withFiles();
      expect(await listKeys()).toHaveLength(2);

      await ana.agent.delete(`/api/cards/${card.id}?files=delete`).expect(204);

      expect(await listKeys()).toEqual([]);
      const rows = await prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM files`;
      expect(Number(rows[0]!.n)).toBe(0);
    });

    const CHOOSE = 'Choose what happens to this card’s files';

    async function expectNothingDeleted(
      ana: Awaited<ReturnType<typeof withFiles>>['ana'],
      cardId: string,
      keys: number,
    ) {
      await ana.agent.get(`/api/cards/${cardId}`).expect(200);
      const list = await ana.agent.get(`/api/cards/${cardId}/files`);
      expect(list.body.files).toHaveLength(keys);
      expect(await listKeys()).toHaveLength(keys);
    }

    // 31 (approved 2026-11-14: the choice is required)
    it('refuses with 400 "Choose what happens to this card’s files" when the card has files and neither files=delete nor moveFilesTo is given, and deletes nothing', async () => {
      const { ana, card } = await withFiles();

      const response = await ana.agent.delete(`/api/cards/${card.id}`);

      expect(response.status).toBe(400);
      expect(String(response.body.message)).toContain(CHOOSE);
      await expectNothingDeleted(ana, card.id, 2);
    });

    // 31
    it('refuses with the same 400 when only a subtask chosen for deletion has files', async () => {
      const { ana, card, newSubtask } = await setUp();
      const subtask = await newSubtask(card.id, 'Form');
      await attach(ana, subtask.id, 'form.pdf', Buffer.from('form'));

      const response = await ana.agent
        .delete(`/api/cards/${card.id}`)
        .send({ subtasks: { [subtask.id]: { action: 'delete' } } });

      expect(response.status).toBe(400);
      expect(String(response.body.message)).toContain(CHOOSE);
      await ana.agent.get(`/api/cards/${subtask.id}`).expect(200);
      expect(await listKeys()).toHaveLength(1);
    });

    // 31
    it('needs no choice when the only subtask with files is kept as its own card', async () => {
      const { ana, card, newSubtask } = await setUp();
      const subtask = await newSubtask(card.id, 'Form');
      await attach(ana, subtask.id, 'form.pdf', Buffer.from('form'));

      await ana.agent
        .delete(`/api/cards/${card.id}`)
        .send({ subtasks: { [subtask.id]: { action: 'standalone' } } })
        .expect(204);

      expect(await listKeys()).toHaveLength(1);
    });

    // 31
    it('refuses with 400 when both files=delete and moveFilesTo are given, and deletes nothing', async () => {
      const { ana, card, newCard } = await withFiles();
      const target = await newCard('Target');

      const response = await ana.agent.delete(
        `/api/cards/${card.id}?files=delete&moveFilesTo=${target.id}`,
      );

      expect(response.status).toBe(400);
      await expectNothingDeleted(ana, card.id, 2);
    });

    // 31
    it('refuses a files value other than delete', async () => {
      const { ana, card } = await withFiles();

      await ana.agent.delete(`/api/cards/${card.id}?files=keep`).expect(400);

      await expectNothingDeleted(ana, card.id, 2);
    });

    // 31
    it('accepts files=delete for a card with no files', async () => {
      const { ana, newCard } = await setUp();
      const empty = await newCard('Empty');

      await ana.agent.delete(`/api/cards/${empty.id}?files=delete`).expect(204);

      await ana.agent.get(`/api/cards/${empty.id}`).expect(404);
    });

    // 31
    it('deletes a card with no files when neither is given', async () => {
      const { ana, newCard } = await setUp();
      const empty = await newCard('Empty');

      await ana.agent.delete(`/api/cards/${empty.id}`).expect(204);

      await ana.agent.get(`/api/cards/${empty.id}`).expect(404);
    });

    // 31
    it('refuses with 400, not 204, when a file was attached after the person looked (the choice is checked inside the delete)', async () => {
      const { ana, card } = await setUp();
      // The card had no files when the dialog opened; now it has one.
      await attach(ana, card.id, 'late.pdf', Buffer.from('late'));

      const response = await ana.agent.delete(`/api/cards/${card.id}`);

      expect(response.status).toBe(400);
      expect(String(response.body.message)).toContain(CHOOSE);
      await expectNothingDeleted(ana, card.id, 1);
    });

    // 31
    it('deletes the files of a subtask chosen for deletion, and keeps the others', async () => {
      const { ana, card, newCard, newSubtask } = await withFiles();
      const subtask = await newSubtask(card.id, 'Form');
      await attach(ana, subtask.id, 'form.pdf', Buffer.from('form'));
      const other = await newCard('Other');
      await attach(ana, other.id, 'other.pdf', Buffer.from('other'));
      expect(await listKeys()).toHaveLength(4);

      await ana.agent
        .delete(`/api/cards/${card.id}?files=delete`)
        .send({ subtasks: { [subtask.id]: { action: 'delete' } } })
        .expect(204);

      const keys = await listKeys();
      expect(keys).toHaveLength(1);
      await expect(getObject(keys[0]!)).resolves.toEqual(Buffer.from('other'));
    });

    // 31
    it('keeps the files of a subtask that becomes its own card', async () => {
      const { ana, card, newSubtask } = await withFiles();
      const subtask = await newSubtask(card.id, 'Form');
      await attach(ana, subtask.id, 'form.pdf', Buffer.from('form'));

      await ana.agent
        .delete(`/api/cards/${card.id}?files=delete`)
        .send({ subtasks: { [subtask.id]: { action: 'standalone' } } })
        .expect(204);

      expect(await listKeys()).toHaveLength(1);
      const list = await ana.agent.get(`/api/cards/${subtask.id}/files`);
      expect(list.body.files.map((f: { name: string }) => f.name)).toEqual([
        'form.pdf',
      ]);
    });

    // 31
    it('moves the files to the card named by moveFilesTo, keeping them in storage', async () => {
      const { ana, card, one, two, newCard } = await withFiles();
      const target = await newCard('Target');
      const keysBefore = (await listKeys()).sort(byText);

      await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
        .expect(204);

      const list = await ana.agent
        .get(`/api/cards/${target.id}/files`)
        .expect(200);
      expect(
        list.body.files.map((f: { id: string }) => f.id).sort(byText),
      ).toEqual([one.id, two.id].sort(byText));
      // Nothing in storage changes, and the files still download.
      expect((await listKeys()).sort(byText)).toEqual(keysBefore);
      const download = await ana.agent
        .get(`/api/files/${one.id}/download`)
        .expect(200);
      expect(download.body).toEqual(Buffer.from('one'));
      await ana.agent.get(`/api/cards/${card.id}`).expect(404);
    });

    // 31
    it('writes one Activity line on the picked card for each moved file', async () => {
      const { ana, card, one, two, newCard } = await withFiles();
      const target = await newCard('Target');
      const before = (await ana.agent.get(`/api/cards/${target.id}/activity`))
        .body.items.length as number;

      await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
        .expect(204);

      const after = (await ana.agent.get(`/api/cards/${target.id}/activity`))
        .body.items as {
        kind: string;
        details: { fileId?: string; name?: string };
      }[];
      const added = after.slice(0, after.length - before);
      expect(added).toHaveLength(2);
      expect(added.map((line) => line.kind)).toEqual([
        'FILE_MOVED',
        'FILE_MOVED',
      ]);
      expect(added.map((line) => line.details.fileId).sort(byText)).toEqual(
        [one.id, two.id].sort(byText),
      );
      expect(added.map((line) => line.details.name).sort(byText)).toEqual([
        'one.pdf',
        'two.pdf',
      ]);
    });

    // 31
    it('sends a card signal for the picked card', async () => {
      const { ana, cara, card, board, newCard } = await withFiles();
      const target = await newCard('Target');
      const anaLive = await connect(app, cookieOf(ana.agent));
      const caraLive = await connect(app, cookieOf(cara.agent));
      await join(anaLive, board.id);
      await join(caraLive, board.id);

      await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${target.id}`)
        .set(LIVE_HEADER, anaLive.id)
        .expect(204);

      await until(
        () =>
          caraLive.signals.some(
            (s) => s.type === 'card' && s.cardId === target.id,
          ),
        'a card signal for the picked card',
      );
    });

    // 31
    it('deletes nothing and answers 404 "Card not found" when the picked card is unknown or in another project', async () => {
      const { ana, card, cardInOtherProject } = await withFiles();
      const elsewhere = await cardInOtherProject();

      for (const target of [UNKNOWN_ID, elsewhere.id]) {
        const response = await ana.agent
          .delete(`/api/cards/${card.id}?moveFilesTo=${target}`)
          .expect(404);
        expect(String(response.body.message)).toContain('Card not found');
      }

      await ana.agent.get(`/api/cards/${card.id}`).expect(200);
      const list = await ana.agent.get(`/api/cards/${card.id}/files`);
      expect(list.body.files).toHaveLength(2);
      expect(await listKeys()).toHaveLength(2);
    });

    // 31
    it('does not let the picked card be the card being deleted or a subtask deleted with it', async () => {
      const { ana, card, newSubtask } = await withFiles();
      const subtask = await newSubtask(card.id, 'Form');

      const toItself = await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${card.id}`)
        .send({ subtasks: { [subtask.id]: { action: 'standalone' } } });
      const toSubtask = await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=${subtask.id}`)
        .send({ subtasks: { [subtask.id]: { action: 'delete' } } });

      expect(toItself.status).toBe(400);
      expect(String(toItself.body.message)).toContain(
        'Pick a card that is not being deleted',
      );
      expect(toSubtask.status).toBe(400);
      expect(String(toSubtask.body.message)).toContain(
        'Pick a card that is not being deleted',
      );
      await ana.agent.get(`/api/cards/${card.id}`).expect(200);
      expect(await listKeys()).toHaveLength(2);
    });

    // 31
    it('refuses a moveFilesTo that is not an id', async () => {
      const { ana, card } = await withFiles();

      await ana.agent
        .delete(`/api/cards/${card.id}?moveFilesTo=not-an-id`)
        .expect(400);

      await ana.agent.get(`/api/cards/${card.id}`).expect(200);
    });
  });
});
