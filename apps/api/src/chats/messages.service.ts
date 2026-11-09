import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';

export const PAGE_SIZE = 50;

const personSelect = { select: { id: true, displayName: true } } as const;
const withPeople = { author: personSelect, deletedBy: personSelect } as const;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof withPeople }>;

// A message as the API sends it (the Message type in @tessera/shared, with
// dates that become ISO text in the JSON).
export type MessageView = Omit<
  MessageRow,
  'authorId' | 'deletedById' | 'author' | 'deletedBy'
> & {
  author: { id: string; displayName: string } | null;
  deletedBy: { id: string; displayName: string } | null;
};

export interface MessagePageView {
  messages: MessageView[];
  hasOlder: boolean;
}

function toView(row: MessageRow): MessageView {
  const { authorId: _a, deletedById: _d, ...rest } = row;
  return rest;
}

// Messages of the chats the user can see. A chat or message the user cannot
// see is reported as not found, so non-members cannot tell it exists.
// A deleted message keeps its body and is still listed.
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  // The newest PAGE_SIZE messages, or the PAGE_SIZE just before `beforeId`,
  // oldest first. They are ordered by (created_at, id) so that messages
  // sent at the same moment are never repeated or skipped between pages.
  async listMessages(
    userId: string,
    chatId: string,
    beforeId?: string,
  ): Promise<MessagePageView> {
    await this.findVisibleChat(userId, chatId);
    const before = beforeId
      ? await this.prisma.message.findFirst({
          where: { id: beforeId, chatId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (beforeId && !before) {
      throw new NotFoundException('Message not found');
    }

    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        ...(before && {
          OR: [
            { createdAt: { lt: before.createdAt } },
            { createdAt: before.createdAt, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      include: withPeople,
    });
    return {
      messages: rows.slice(0, PAGE_SIZE).reverse().map(toView),
      hasOlder: rows.length > PAGE_SIZE,
    };
  }

  async sendMessage(
    userId: string,
    chatId: string,
    body: string,
  ): Promise<MessageView> {
    await this.findVisibleChat(userId, chatId);
    const row = await this.prisma.message.create({
      data: { chatId, authorId: userId, body },
      include: withPeople,
    });
    return toView(row);
  }

  // Only the author may edit, and not once the message is deleted.
  async editMessage(
    userId: string,
    messageId: string,
    body: string,
  ): Promise<MessageView> {
    const message = await this.findVisibleMessage(userId, messageId);
    if (message.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit a message');
    }
    // The check on deletedAt is part of the update, so an edit that races
    // with a delete cannot change a deleted message.
    const { count } = await this.prisma.message.updateMany({
      where: { id: message.id, deletedAt: null },
      data: { body, editedAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException(DELETED_MESSAGE);
    }
    return this.reload(message.id);
  }

  // The author or a project admin may delete. The first delete wins: the
  // body is kept, and nobody can delete it again.
  async deleteMessage(userId: string, messageId: string): Promise<MessageView> {
    const message = await this.findVisibleMessage(userId, messageId);
    if (message.authorId !== userId) {
      const membership = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: message.chat.board.projectId,
            userId,
          },
        },
      });
      if (membership?.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Only the author or a project admin can delete a message',
        );
      }
    }
    const { count } = await this.prisma.message.updateMany({
      where: { id: message.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    if (count === 0) {
      throw new ConflictException(DELETED_MESSAGE);
    }
    return this.reload(message.id);
  }

  private async findVisibleChat(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, board: boardsVisibleTo(userId) },
      select: { id: true },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    return chat;
  }

  private async findVisibleMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, chat: { board: boardsVisibleTo(userId) } },
      include: { chat: { select: { board: { select: { projectId: true } } } } },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  private async reload(messageId: string): Promise<MessageView> {
    const row = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: withPeople,
    });
    return toView(row);
  }
}

const DELETED_MESSAGE = 'This message was deleted';
