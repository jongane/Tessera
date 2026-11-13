import type { Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service.js';
import { LiveGateway } from './live.gateway.js';
import type { LiveService } from './live.service.js';

// Review and attack fixes, criterion 37 (the first test is the antagonist's
// proof). Switching board quickly, A then B: the membership check of each
// join is a separate database query, and the two can finish in either order.
// The tab must end up in the room of the last board it asked for.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeSocket() {
  const rooms = new Set<string>(['own-id']);
  return {
    rooms,
    data: { userId: 'user-1' },
    join: (room: string) => void rooms.add(room),
    leave: (room: string) => void rooms.delete(room),
  };
}

describe('LiveGateway join-board (race)', () => {
  // 37
  it('ends in the room of the last board asked for, when an earlier join answers later', async () => {
    let allowA = (_ok: boolean) => {};
    const live = {
      mayJoin: (_userId: string, boardId: string) =>
        boardId === A
          ? new Promise<boolean>((resolve) => (allowA = resolve))
          : Promise.resolve(true),
    } as unknown as LiveService;
    const gateway = new LiveGateway({} as AuthService, live);
    const socket = fakeSocket();
    const client = socket as unknown as Socket;

    // The web app: join A, then (board changed) leave and join B.
    const joinA = gateway.joinBoard(client, { boardId: A });
    await gateway.leaveBoard(client);
    await gateway.joinBoard(client, { boardId: B });
    // A's membership check answers last.
    allowA(true);
    await joinA;

    expect([...socket.rooms].filter((r) => r.startsWith('board:'))).toEqual([
      `board:${B}`,
    ]);
  });

  // 37: the person is removed from the project after the membership check
  // said yes and before the join. The room must not keep them (the gateway
  // checks again once the socket is in the room).
  it('leaves the person out of the room when they were removed between the membership check and the join', async () => {
    let checks = 0;
    const live = {
      mayJoin: () => Promise.resolve(++checks === 1),
    } as unknown as LiveService;
    const gateway = new LiveGateway({} as AuthService, live);
    const socket = fakeSocket();

    const reply = await gateway.joinBoard(socket as unknown as Socket, {
      boardId: A,
    });

    expect(reply).toEqual({ ok: false });
    expect([...socket.rooms].filter((r) => r.startsWith('board:'))).toEqual([]);
  });
});
