import type { Server } from 'socket.io';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LiveService } from './live.service.js';

// Live updates PR, final fixes (criterion 56; the antagonist's proof, kept as
// a regression test). A bad LIVE_SESSION_SWEEP_MS must not make the sweep run
// every millisecond. Node's timers take at most 2147483647 ms (about 24.8 days); a
// larger value is replaced by 1 ms, so a long interval sweeps without pause.
describe('LiveService session sweep (criterion 56)', () => {
  afterEach(() => {
    delete process.env['LIVE_SESSION_SWEEP_MS'];
  });

  // 56
  it('does not sweep every millisecond when LIVE_SESSION_SWEEP_MS is 30 days', async () => {
    process.env['LIVE_SESSION_SWEEP_MS'] = String(30 * 24 * 60 * 60 * 1000);
    let sweeps = 0;
    const server = {
      fetchSockets: () => {
        sweeps += 1;
        return Promise.resolve([]);
      },
    } as unknown as Server;
    const live = new LiveService({} as PrismaService);
    live.attach(server);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      live.onModuleDestroy();
    }
    expect(sweeps).toBe(0);
  });
});
