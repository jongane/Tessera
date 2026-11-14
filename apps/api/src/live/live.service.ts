import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'socket.io';
import { boardsVisibleTo } from '../boards/board-access.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sweepIntervalFrom } from './live-sweep.js';
import {
  boardRoom,
  boardSignal,
  cardSignal,
  chatsSignal,
  type LiveSignal,
  messageSignal,
} from './live-signal.js';

export interface CardTarget {
  id: string;
  boardId: string;
}

// Everything one save should tell the boards about.
export interface SignalPlan {
  cards: CardTarget[];
  boards: string[];
  chats: string[];
}

export interface PlanOptions {
  // Also signal the board (a card came, went or moved).
  board?: boolean;
  // Also signal the chat list (a chat came, or was linked or unlinked).
  chats?: boolean;
  // Also signal every card below the given ones.
  below?: boolean;
}

export const emptyPlan = (): SignalPlan => ({
  cards: [],
  boards: [],
  chats: [],
});

// Sends the signals, and keeps the rooms right. The gateway attaches the
// Socket.IO server; the rules in live-rules.ts decide what to send.
@Injectable()
export class LiveService implements OnModuleDestroy {
  private readonly log = new Logger(LiveService.name);
  private server: Server | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  attach(server: Server): void {
    this.server = server;
    // A connection already in a room never asks again, so the server looks
    // for expired sessions by itself. Read once, when the app starts.
    const every = sweepIntervalFrom(process.env['LIVE_SESSION_SWEEP_MS']);
    this.sweep = setInterval(() => {
      this.closeExpiredSessions().catch((error: unknown) =>
        this.log.warn(`Session sweep failed: ${String(error)}`),
      );
    }, every);
    this.sweep.unref();
  }

  onModuleDestroy(): void {
    if (this.sweep) {
      clearInterval(this.sweep);
    }
  }

  // Closes the connections whose session has ended or expired.
  private async closeExpiredSessions(): Promise<void> {
    const sockets = (await this.server?.fetchSockets()) ?? [];
    const hashes = [
      ...new Set(sockets.map((s) => s.data.tokenHash as string | undefined)),
    ].filter((h): h is string => h !== undefined);
    if (hashes.length === 0) {
      return;
    }
    const valid = new Set(
      (
        await this.prisma.session.findMany({
          where: { tokenHash: { in: hashes }, expiresAt: { gt: new Date() } },
          select: { tokenHash: true },
        })
      ).map((s) => s.tokenHash),
    );
    for (const socket of sockets) {
      if (!valid.has(socket.data.tokenHash)) {
        socket.disconnect(true);
      }
    }
  }

  // Whether the person is a member of the board's project.
  async mayJoin(userId: string, boardId: string): Promise<boolean> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...boardsVisibleTo(userId) },
      select: { id: true },
    });
    return board !== null;
  }

  async sessionIsValid(tokenHash: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: { expiresAt: true },
    });
    return session !== null && session.expiresAt.getTime() > Date.now();
  }

  // The connection id a save names counts only when it is a live connection
  // of the same session as the save; anything else is nobody's.
  attribute(header: string | null, tokenHash: string | null): string | null {
    if (header === null || tokenHash === null) {
      return null;
    }
    const socket = this.server?.sockets.sockets.get(header);
    return socket?.data.tokenHash === tokenHash ? header : null;
  }

  // The sessions of an account changed (a password change ended the others):
  // connections of sessions that no longer exist close.
  async endEndedSessions(userId: string): Promise<void> {
    const kept = new Set(
      (
        await this.prisma.session.findMany({
          where: { userId },
          select: { tokenHash: true },
        })
      ).map((s) => s.tokenHash),
    );
    for (const socket of (await this.server?.fetchSockets()) ?? []) {
      if (socket.data.userId === userId && !kept.has(socket.data.tokenHash)) {
        socket.disconnect(true);
      }
    }
  }

  async boardOfColumn(columnId: string): Promise<string | null> {
    const row = await this.prisma.column.findUnique({
      where: { id: columnId },
      select: { boardId: true },
    });
    return row?.boardId ?? null;
  }

  // Someone left or was removed: their connections leave the project's
  // boards at once, without reconnecting.
  async leaveProject(projectId: string, userId: string): Promise<void> {
    const boards = await this.prisma.board.findMany({
      where: { projectId },
      select: { id: true },
    });
    for (const { id } of boards) {
      const sockets = await this.server?.in(boardRoom(id)).fetchSockets();
      for (const socket of sockets ?? []) {
        if (socket.data.userId === userId) {
          socket.leave(boardRoom(id));
        }
      }
    }
  }

  // A session ended: its connections close.
  async endSession(tokenHash: string): Promise<void> {
    const sockets = (await this.server?.fetchSockets()) ?? [];
    for (const socket of sockets) {
      if (socket.data.tokenHash === tokenHash) {
        socket.disconnect(true);
      }
    }
  }

  // The cards, boards and chat lists a change touches. A card change also
  // touches the cards above it, which show its progress and totals.
  async plan(
    cardIds: string[],
    options: PlanOptions = {},
  ): Promise<SignalPlan> {
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) {
      return emptyPlan();
    }
    const primary = options.below
      ? await this.cardsBelow(ids)
      : await this.cardsByIds(ids);
    const above = await this.cardsAbove(ids);
    const boards = [...new Set(primary.map((c) => c.boardId))];
    return {
      cards: dedupe([...primary, ...above]),
      boards: options.board ? boards : [],
      chats: options.chats ? boards : [],
    };
  }

  merge(...plans: SignalPlan[]): SignalPlan {
    return {
      cards: dedupe(plans.flatMap((p) => p.cards)),
      boards: [...new Set(plans.flatMap((p) => p.boards))],
      chats: [...new Set(plans.flatMap((p) => p.chats))],
    };
  }

  send(by: string | null, plan: SignalPlan): void {
    for (const card of plan.cards) {
      this.emit(cardSignal(card.boardId, card.id, by));
    }
    for (const boardId of plan.boards) {
      this.emit(boardSignal(boardId, by));
    }
    for (const boardId of plan.chats) {
      this.emit(chatsSignal(boardId, by));
    }
  }

  sendBoard(by: string | null, boardId: string): void {
    this.emit(boardSignal(boardId, by));
  }

  sendChats(by: string | null, boardId: string): void {
    this.emit(chatsSignal(boardId, by));
  }

  sendMessage(
    by: string | null,
    info: { boardId: string; chatId: string },
    messageId: string,
  ): void {
    this.emit(messageSignal(info.boardId, info.chatId, messageId, by));
  }

  private emit(signal: LiveSignal): void {
    try {
      this.server?.to(boardRoom(signal.boardId)).emit('signal', signal);
    } catch (error) {
      this.log.warn(`Could not send a live signal: ${String(error)}`);
    }
  }

  // Lookups the rules need, some of them before the save, while the thing
  // still exists.

  async cardOfChecklist(checklistId: string): Promise<string | null> {
    const row = await this.prisma.checklist.findUnique({
      where: { id: checklistId },
      select: { cardId: true },
    });
    return row?.cardId ?? null;
  }

  async cardOfItem(itemId: string): Promise<string | null> {
    const row = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: { checklist: { select: { cardId: true } } },
    });
    return row?.checklist.cardId ?? null;
  }

  async cardOfEntry(entryId: string): Promise<string | null> {
    const row = await this.prisma.timeEntry.findUnique({
      where: { id: entryId },
      select: { cardId: true },
    });
    return row?.cardId ?? null;
  }

  async cardOfFile(fileId: string): Promise<string | null> {
    const row = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { cardId: true },
    });
    return row?.cardId ?? null;
  }

  async cardOfRunningTimer(userId: string): Promise<string | null> {
    const row = await this.prisma.runningTimer.findFirst({
      where: { userId },
      select: { cardId: true },
    });
    return row?.cardId ?? null;
  }

  chatInfo(chatId: string) {
    return this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { boardId: true, cardId: true },
    });
  }

  async messageInfo(messageId: string) {
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { chatId: true, chat: { select: { boardId: true } } },
    });
    return row && { chatId: row.chatId, boardId: row.chat.boardId };
  }

  private cardsByIds(ids: string[]): Promise<CardTarget[]> {
    return this.prisma.card.findMany({
      where: { id: { in: ids } },
      select: { id: true, boardId: true },
    });
  }

  private cardsAbove(ids: string[]): Promise<CardTarget[]> {
    return this.prisma.$queryRaw<CardTarget[]>`
      WITH RECURSIVE up AS (
        SELECT id, board_id, parent_id FROM cards WHERE id = ANY(${ids}::uuid[])
        UNION
        SELECT c.id, c.board_id, c.parent_id FROM cards c JOIN up ON c.id = up.parent_id
      )
      SELECT id, board_id AS "boardId" FROM up`;
  }

  private cardsBelow(ids: string[]): Promise<CardTarget[]> {
    return this.prisma.$queryRaw<CardTarget[]>`
      WITH RECURSIVE below AS (
        SELECT id, board_id FROM cards WHERE id = ANY(${ids}::uuid[])
        UNION
        SELECT c.id, c.board_id FROM cards c JOIN below b ON c.parent_id = b.id
      )
      SELECT id, board_id AS "boardId" FROM below`;
  }
}

function dedupe(cards: CardTarget[]): CardTarget[] {
  return [...new Map(cards.map((c) => [c.id, c])).values()];
}
