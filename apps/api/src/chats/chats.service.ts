import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Chat } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { ALREADY_LINKED, refuseGeneralChat } from './chat-rules.js';

export interface NewChat {
  title: string;
}

// Every method takes the user's id and only touches chats on boards the
// user can see. A chat the user cannot see is reported as not found.
@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

  // A chat on its own, not linked to any card.
  async createChat(
    userId: string,
    boardId: string,
    chat: NewChat,
  ): Promise<Chat> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...boardsVisibleTo(userId) },
      select: { id: true },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }

    return this.prisma.chat.create({
      data: { ...chat, boardId: board.id, kind: 'TOPIC' },
    });
  }

  // The general chat first, then the others oldest first.
  // Empty when the user cannot see the board.
  listChatsForBoard(userId: string, boardId: string): Promise<Chat[]> {
    return this.prisma.chat.findMany({
      where: { boardId, board: boardsVisibleTo(userId) },
      // GENERAL is declared before TOPIC in the enum, so it sorts first.
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // Links a chat to a card on the same board. Refused when the chat is
  // the board's general chat, is already linked to a card, or the card
  // already has a chat: unlink first.
  async linkChatToCard(
    userId: string,
    chatId: string,
    cardId: string,
  ): Promise<Chat> {
    const chat = await this.findVisibleChat(userId, chatId);
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, boardId: chat.boardId },
      include: { chat: { select: { id: true } } },
    });
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    refuseGeneralChat(chat.kind);
    if (chat.cardId !== null && chat.cardId !== card.id) {
      throw new ConflictException(ALREADY_LINKED);
    }
    if (card.chat && card.chat.id !== chat.id) {
      throw new ConflictException('This card already has a chat');
    }

    try {
      return await this.prisma.chat.update({
        where: { id: chat.id },
        data: { cardId: card.id },
      });
    } catch (error) {
      // Someone else linked a chat to this card a moment ago.
      if (isUniqueViolation(error)) {
        throw new ConflictException('This card already has a chat');
      }
      throw error;
    }
  }

  // Removes a chat's link to its card. Both are kept.
  async unlinkChat(userId: string, chatId: string): Promise<Chat> {
    const chat = await this.findVisibleChat(userId, chatId);

    return this.prisma.chat.update({
      where: { id: chat.id },
      data: { cardId: null },
    });
  }

  private async findVisibleChat(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, board: boardsVisibleTo(userId) },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    return chat;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
