import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { Server } from 'node:http';
import type TestAgent from 'supertest/lib/agent.js';
import { boardScenario } from './board-scenario.js';
import { cookieOf } from './live.js';
import { multipart, type Part } from './multipart.js';

// Helpers for the file end-to-end tests (files on cards, PR A).

type Agent = InstanceType<typeof TestAgent>;

// Sends one file in the form field `file`, as a browser does. Use `parts`
// instead of `file` to send something else (two files, no file, other fields).
export function upload(
  agent: Agent,
  cardId: string,
  what: {
    filename: string;
    data: Buffer | string;
    contentType?: string;
    extra?: Part[];
  },
) {
  const { body, contentType } = multipart([
    {
      field: 'file',
      filename: what.filename,
      contentType: what.contentType,
      data: what.data,
    },
    ...(what.extra ?? []),
  ]);
  return agent
    .post(`/api/cards/${cardId}/files`)
    .set('Content-Type', contentType)
    .send(body);
}

export function uploadParts(agent: Agent, cardId: string, parts: Part[]) {
  const { body, contentType } = multipart(parts);
  return agent
    .post(`/api/cards/${cardId}/files`)
    .set('Content-Type', contentType)
    .send(body);
}

// A file with the content `data` as the `file` part, for the common case.
export function part(filename: string, data: Buffer | string): Part {
  return { field: 'file', filename, data };
}

// One upload sent in pieces with no Content-Length (chunked), so the server
// cannot know the size beforehand. Resolves to the status and the body text.
export async function uploadChunked(
  app: INestApplication<App>,
  agent: unknown,
  cardId: string,
  filename: string,
  data: Buffer,
): Promise<{ status: number; text: string }> {
  const { port } = (
    app.getHttpServer() as unknown as Server
  ).address() as AddressInfo;
  const { body, contentType } = multipart([part(filename, data)]);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/api/cards/${cardId}/files`,
        headers: {
          'Content-Type': contentType,
          'Transfer-Encoding': 'chunked',
          Cookie: cookieOf(agent),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    // A reset after the answer (the server stops reading) is not a failure.
    req.on('error', reject);
    const size = 64 * 1024;
    for (let i = 0; i < body.length; i += size)
      req.write(body.subarray(i, i + size));
    req.end();
  });
}

// boardScenario plus helpers to make more cards, subtasks and projects.
export async function fileScenario(app: INestApplication<App>) {
  const scenario = await boardScenario(app);
  const { ana, toDo, board, card } = scenario;
  async function newCard(title: string) {
    return (
      await ana.agent
        .post(`/api/columns/${toDo.id}/cards`)
        .send({ title })
        .expect(201)
    ).body as { id: string; number?: string };
  }
  async function newSubtask(parentId: string, title: string) {
    return (
      await ana.agent
        .post(`/api/cards/${parentId}/subtasks`)
        .send({ columnId: toDo.id, title })
        .expect(201)
    ).body as { id: string };
  }
  // A card in another project that only Ana belongs to.
  async function cardInOtherProject() {
    const project = (
      await ana.agent
        .post('/api/projects')
        .send({ name: 'Other', code: 'OTH' })
        .expect(201)
    ).body as { id: string };
    const otherBoard = (
      await ana.agent
        .post(`/api/projects/${project.id}/boards`)
        .send({ name: 'Elsewhere' })
        .expect(201)
    ).body as { id: string };
    const columns = (await ana.agent.get(`/api/boards/${otherBoard.id}`)).body
      .columns as { id: string }[];
    return (
      await ana.agent
        .post(`/api/columns/${columns[0]!.id}/cards`)
        .send({ title: 'Other card' })
        .expect(201)
    ).body as { id: string };
  }
  return { ...scenario, board, card, newCard, newSubtask, cardInOtherProject };
}

// Files on messages, PR B: the same for a chat's pending upload
// (POST /api/chats/:chatId/files).
export function uploadToChat(
  agent: Agent,
  chatId: string,
  what: {
    filename: string;
    data: Buffer | string;
    contentType?: string;
    extra?: Part[];
  },
) {
  const { body, contentType } = multipart([
    {
      field: 'file',
      filename: what.filename,
      contentType: what.contentType,
      data: what.data,
    },
    ...(what.extra ?? []),
  ]);
  return agent
    .post(`/api/chats/${chatId}/files`)
    .set('Content-Type', contentType)
    .send(body);
}

export function uploadPartsToChat(agent: Agent, chatId: string, parts: Part[]) {
  const { body, contentType } = multipart(parts);
  return agent
    .post(`/api/chats/${chatId}/files`)
    .set('Content-Type', contentType)
    .send(body);
}

// A file as the API gives it (docs/api.md, "Files").
export interface FileJson {
  id: string;
  name: string;
  size: number;
  isImage: boolean;
  uploader: { id: string; displayName: string } | null;
  createdAt: string;
  messageId: string | null;
  chatId: string | null;
  pending: boolean;
}

export interface MessageJson {
  id: string;
  chatId: string;
  body: string;
  files: FileJson[];
  deletedAt: string | null;
}

// fileScenario plus the board's general chat, the card's own chat and
// helpers to upload pending files and send messages. Ana is the project's
// admin, Cara a plain member, Ben not a member.
export async function messageFileScenario(app: INestApplication<App>) {
  const scenario = await fileScenario(app);
  const { ana, board, card } = scenario;
  const chats = (await ana.agent.get(`/api/boards/${board.id}/chats`)).body as {
    id: string;
    kind: string;
  }[];
  const general = chats.find((c) => c.kind === 'GENERAL')!;
  const cardChat = (await ana.agent.get(`/api/cards/${card.id}`)).body.chat as {
    id: string;
  };

  type Who = { agent: Agent };

  // `who` uploads `name` as a pending file in `chatId`.
  async function pend(
    who: Who,
    chatId: string,
    name: string,
    data: Buffer | string = Buffer.from(`%PDF-1.7 ${name}`),
  ): Promise<FileJson> {
    const response = await uploadToChat(who.agent, chatId, {
      filename: name,
      data,
    }).expect(201);
    return response.body as FileJson;
  }

  // `who` sends a message with these pending files (ids), and it is saved.
  async function sendWith(
    who: Who,
    chatId: string,
    body: string,
    fileIds: string[],
  ): Promise<MessageJson> {
    const response = await who.agent
      .post(`/api/chats/${chatId}/messages`)
      .send({ body, fileIds })
      .expect(201);
    return response.body as MessageJson;
  }

  return {
    ...scenario,
    general,
    cardChat,
    pend,
    sendWith,
  };
}
