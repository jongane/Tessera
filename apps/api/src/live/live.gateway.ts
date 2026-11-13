import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session-cookie.js';
import { hashToken } from '../auth/session-token.js';
import { boardRoom } from './live-signal.js';
import { LiveService } from './live.service.js';

const joinSchema = z.object({ boardId: z.uuid() });

// The live connection (Socket.IO at /socket.io, on the API's own address, so
// the sign-in cookie comes with it). Someone without a session is refused.
// A signed-in person joins a board's room if they are a member of its
// project, and then receives that board's signals (see LiveService).
@WebSocketGateway({ path: '/socket.io' })
export class LiveGateway implements OnGatewayInit {
  constructor(
    private readonly auth: AuthService,
    private readonly live: LiveService,
  ) {}

  afterInit(server: Server): void {
    this.live.attach(server);
    server.use((socket, next) => {
      this.signIn(socket).then(
        () => next(),
        () => next(new Error('Please sign in')),
      );
    });
  }

  // Joining a board leaves the one before: a tab shows one board at a time.
  // The last board asked for wins, even when an earlier answer comes later.
  @SubscribeMessage('join-board')
  async joinBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false };
    }
    const { boardId } = parsed.data;
    const userId = client.data.userId as string;
    client.data.wantedBoard = boardId;
    if (!(await this.stillSignedIn(client))) {
      return { ok: false };
    }
    if (
      !(await this.live.mayJoin(userId, boardId)) ||
      client.data.wantedBoard !== boardId
    ) {
      return { ok: false };
    }
    await leaveBoards(client);
    await client.join(boardRoom(boardId));
    // Removed from the project while joining: the room must not keep them.
    if (
      client.data.wantedBoard !== boardId ||
      !(await this.live.mayJoin(userId, boardId))
    ) {
      await client.leave(boardRoom(boardId));
      return { ok: false };
    }
    return { ok: true };
  }

  @SubscribeMessage('leave-board')
  async leaveBoard(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    client.data.wantedBoard = null;
    await leaveBoards(client);
    return { ok: true };
  }

  // A session that has ended or expired cannot join, and its connection
  // closes.
  private async stillSignedIn(client: Socket): Promise<boolean> {
    const tokenHash = client.data.tokenHash as string | undefined;
    if (
      tokenHash === undefined ||
      (await this.live.sessionIsValid(tokenHash))
    ) {
      return true;
    }
    client.disconnect(true);
    return false;
  }

  private async signIn(socket: Socket): Promise<void> {
    const token = cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE);
    const session = token ? await this.auth.findSession(token) : null;
    if (!token || !session) {
      throw new Error('Please sign in');
    }
    socket.data.userId = session.user.id;
    socket.data.tokenHash = hashToken(token);
  }
}

async function leaveBoards(client: Socket): Promise<void> {
  for (const room of client.rooms) {
    if (room.startsWith('board:')) {
      await client.leave(room);
    }
  }
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}
