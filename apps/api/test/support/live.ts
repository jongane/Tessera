import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { startTestApp, testPassword } from './test-app.js';

// Helpers for the live-updates end-to-end tests (plan "live updates").
//
// The contract these tests assume, which the gateway must follow:
// - Socket.IO at path /socket.io on the API's own address, sign-in cookie
//   read from the handshake. Without a valid session the handshake fails
//   (the client gets `connect_error`).
// - The client joins a board's room with the event `join-board`, payload
//   `{ boardId }`, and an acknowledgement `{ ok: true }` or `{ ok: false }`.
// - The server sends each signal as the event `signal`.
// - The connection id a browser sends in the X-Live-Connection header is
//   the Socket.IO `socket.id`.

export const LIVE_HEADER = 'X-Live-Connection';

export interface LiveSignal {
  type: 'card' | 'board' | 'chats' | 'message';
  boardId: string;
  cardId?: string;
  chatId?: string;
  messageId?: string;
  by: string | null;
}

// The whole API, listening on a free port (Socket.IO needs a real server).
export async function startLiveApp() {
  const started = await startTestApp();
  await started.app.listen(0);
  return started;
}

function origin(app: INestApplication<App>): string {
  const address = (
    app.getHttpServer() as unknown as Server
  ).address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

// A new session for someone who already has an account: the cookie to send.
export async function signInCookie(
  app: INestApplication<App>,
  name: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: `${name}@example.com`, password: testPassword })
    .expect(200);
  const cookies = response.headers['set-cookie'] as unknown as string[];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export async function signOutWith(
  app: INestApplication<App>,
  cookie: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/auth/sign-out')
    .set('Cookie', cookie)
    .expect(204);
}

export interface LiveClient {
  socket: Socket;
  signals: LiveSignal[];
  id: string;
}

const open: Socket[] = [];

export function closeAllSockets(): void {
  for (const socket of open.splice(0)) socket.close();
}

function client(app: INestApplication<App>, cookie?: string): Socket {
  const socket = io(origin(app), {
    path: '/socket.io',
    reconnection: false,
    forceNew: true,
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  open.push(socket);
  return socket;
}

// Connects and listens for signals. Fails if the connection is refused.
export async function connect(
  app: INestApplication<App>,
  cookie: string,
): Promise<LiveClient> {
  const socket = client(app, cookie);
  const signals: LiveSignal[] = [];
  socket.on('signal', (signal: LiveSignal) => signals.push(signal));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (error) =>
      reject(new Error(`connection refused: ${error.message}`)),
    );
  });
  return { socket, signals, id: socket.id! };
}

// Tries to connect: whether it was let in.
export async function isLetIn(
  app: INestApplication<App>,
  cookie?: string,
): Promise<boolean> {
  const socket = client(app, cookie);
  const outcome = await new Promise<boolean>((resolve) => {
    socket.once('connect', () => resolve(true));
    socket.once('connect_error', () => resolve(false));
  });
  socket.close();
  return outcome;
}

// Asks to join a board's room: whether the server said yes.
export async function join(who: LiveClient, boardId: string): Promise<boolean> {
  const reply = (await who.socket
    .timeout(3000)
    .emitWithAck('join-board', { boardId })) as { ok: boolean };
  return reply.ok;
}

// Waits until `check` is true.
export async function until(
  check: () => boolean,
  what: string,
  ms = 3000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Gave up waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Time for a signal that should not come to arrive anyway.
export function quiet(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
