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
