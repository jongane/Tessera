import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import {
  closeAllSockets,
  connect,
  join,
  quiet,
  signInCookie,
  startLiveApp,
  until,
} from './support/live.js';
import { resetDatabase } from './support/reset-database.js';

// Live updates PR, review and attack fixes round 2, criterion 43 (the
// antagonist's proof, kept as a regression test). The server looks for
// expired sessions every LIVE_SESSION_SWEEP_MS milliseconds (read when the
// app starts; 30000 when not set, so within a minute of the expiry). The test
// sets a short one instead of waiting.
describe('Live updates: attacks, round 2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.LIVE_SESSION_SWEEP_MS = '200';
    ({ app, prisma } = await startLiveApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterEach(() => {
    closeAllSockets();
  });

  afterAll(async () => {
    delete process.env.LIVE_SESSION_SWEEP_MS;
    await app.close();
  });

  // 43 (and 35): a connection already in a room never asks to join again, so
  // the server must look at its session by itself.
  it('closes a connection whose session has expired, without waiting for a join, and sends it nothing more', async () => {
    const s = await boardScenario(app);
    const caraLive = await connect(app, await signInCookie(app, 'cara'));
    expect(await join(caraLive, s.board.id)).toBe(true);

    // All of Cara's sessions expire (the scenario's own agent session
    // included, which is not used again).
    await prisma.session.updateMany({
      where: { user: { email: 'cara@example.com' } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await until(
      () => !caraLive.socket.connected,
      'the expired session’s connection to close',
      3000,
    );
    await s.ana.agent
      .patch(s.cardUrl)
      .send({ title: 'After Cara’s session ended' })
      .expect(200);
    await quiet(300);
    expect(caraLive.signals).toEqual([]);
  }, 20_000);

  // 43
  it('keeps the connection of a session that has not expired', async () => {
    const s = await boardScenario(app);
    const anaLive = await connect(app, await signInCookie(app, 'ana'));
    expect(await join(anaLive, s.board.id)).toBe(true);

    await quiet(800);

    expect(anaLive.socket.connected).toBe(true);
  });
});
