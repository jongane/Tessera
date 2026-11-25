import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type FileInfo,
  MESSAGE_BLANK_MESSAGE,
  MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE,
} from '@tessera/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { retryOnCollision } from '../common/retry-on-collision.js';
import { inUploadOrder, toFileInfo, withUploader } from '../files/file-view.js';
import { FilesService } from '../files/files.service.js';

export const PAGE_SIZE = 50;

const personSelect = { select: { id: true, displayName: true } } as const;
const withPeople = {
  author: personSelect,
  deletedBy: personSelect,
  // One query for the files of every message listed, not one per message.
  files: { include: withUploader, orderBy: inUploadOrder },
} satisfies Prisma.MessageInclude;

const A_FILE_IS_GONE = 'A file is no longer there. Remove it and try again.';
const collision = { message: MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE };

type MessageRow = Prisma.MessageGetPayload<{ include: typeof withPeople }>;

// A message as the API sends it (the Message type in @tessera/shared, with
// dates that become ISO text in the JSON).
export type MessageView = Omit<
  MessageRow,
  'authorId' | 'deletedById' | 'author' | 'deletedBy' | 'files'
> & {
  author: { id: string; displayName: string } | null;
  deletedBy: { id: string; displayName: string } | null;
  files: FileInfo[];
};

export interface MessagePageView {
  messages: MessageView[];
  hasOlder: boolean;
}

function toView(row: MessageRow): MessageView {
  const { authorId: _a, deletedById: _d, files, ...rest } = row;
  return { ...rest, files: files.map((file) => toFileInfo(file, row.chatId)) };
}

// Messages of the chats the user can see. A chat or message the user cannot
// see is reported as not found, so non-members cannot tell it exists.
// A deleted message keeps its body and is still listed.
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

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

  async getMessage(userId: string, messageId: string): Promise<MessageView> {
    const message = await this.findVisibleMessage(userId, messageId);
    return this.reload(message.id);
  }

  // With an `id`, sending the same message again (same author, same chat)
  // gives the saved message back and saves nothing new, whatever files it
  // names; the id of another person's or another chat's message is refused.
  // The message and its files are saved in one transaction: each file must be
  // the sender's own pending file in this chat.
  async sendMessage(
    userId: string,
    chatId: string,
    body: string,
    id?: string,
    fileIds: string[] = [],
  ): Promise<{ message: MessageView; created: boolean }> {
    await this.findVisibleChat(userId, chatId);
    if (id !== undefined) {
      const saved = await this.findSentOrNothing(userId, chatId, id);
      if (saved) return { message: saved, created: false };
    }
    try {
      const row = await retryOnCollision(
        () =>
          this.prisma.$transaction((tx) =>
            this.saveWithFiles(tx, userId, chatId, body, id, fileIds),
          ),
        collision,
      );
      return { message: toView(row), created: true };
    } catch (error) {
      if (id !== undefined && error instanceof BadRequestException) {
        // The files are gone because this very message (sent twice at once)
        // took them: answer with the saved message.
        const saved = await this.findSentOrNothing(userId, chatId, id);
        if (saved) return { message: saved, created: false };
      }
      // The id is taken, maybe a moment ago by this very message.
      if (id === undefined || !isUniqueViolation(error)) {
        throw error;
      }
      return {
        message: await this.findSent(userId, chatId, id),
        created: false,
      };
    }
  }

  private async saveWithFiles(
    tx: Prisma.TransactionClient,
    userId: string,
    chatId: string,
    body: string,
    id: string | undefined,
    fileIds: string[],
  ): Promise<MessageRow> {
    // Locked, so a file cannot be sent twice or swept while it is sent.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM files
      WHERE id = ANY(${fileIds}::uuid[]) AND pending_chat_id = ${chatId}::uuid
        AND uploader_id = ${userId}::uuid
      FOR UPDATE`;
    if (locked.length !== fileIds.length) {
      throw new BadRequestException(A_FILE_IS_GONE);
    }
    const message = await tx.message.create({
      data: { id, chatId, authorId: userId, body },
    });
    await tx.file.updateMany({
      where: { id: { in: fileIds } },
      data: { messageId: message.id, pendingChatId: null },
    });
    return tx.message.findUniqueOrThrow({
      where: { id: message.id },
      include: withPeople,
    });
  }

  private async findSentOrNothing(
    userId: string,
    chatId: string,
    id: string,
  ): Promise<MessageView | null> {
    const row = await this.prisma.message.findUnique({
      where: { id },
      include: withPeople,
    });
    return row ? this.checkSent(userId, chatId, row) : null;
  }

  private async findSent(
    userId: string,
    chatId: string,
    id: string,
  ): Promise<MessageView> {
    const row = await this.prisma.message.findUnique({
      where: { id },
      include: withPeople,
    });
    if (!row) throw new ConflictException('This message id is already used');
    return this.checkSent(userId, chatId, row);
  }

  private checkSent(
    userId: string,
    chatId: string,
    row: MessageRow,
  ): MessageView {
    if (row.chatId !== chatId || row.author?.id !== userId) {
      throw new ConflictException('This message id is already used');
    }
    return toView(row);
  }

  // Only the author may edit, and not once the message is deleted. Text
  // only: the files are never changed here. The text may be blank only while
  // the message has files.
  async editMessage(
    userId: string,
    messageId: string,
    body: string,
  ): Promise<MessageView> {
    const message = await this.findVisibleMessage(userId, messageId);
    if (message.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit a message');
    }
    await retryOnCollision(
      () =>
        this.prisma.$transaction(async (tx) => {
          // Locked first, as removing a file and deleting are, so the check
          // of the files and the change are one step.
          const locked = await lockMessage(tx, message.id);
          if (locked.deletedAt) throw new ConflictException(DELETED_MESSAGE);
          if (body === '') await refuseBlankWithoutFiles(tx, message.id);
          await tx.message.update({
            where: { id: message.id },
            data: { body, editedAt: new Date() },
          });
        }),
      collision,
    );
    return this.reload(message.id);
  }

  // The author or a project admin may delete. The first delete wins: the
  // body is kept, the files are removed (rows with the delete, objects once
  // it has committed), and nobody can delete it again.
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
    const storageKeys = await retryOnCollision(
      () =>
        this.prisma.$transaction((tx) =>
          this.markDeleted(tx, message.id, userId),
        ),
      collision,
    );
    await this.files.deleteObjects(storageKeys);
    return this.reload(message.id);
  }

  // Answers the storage keys of the files whose rows it removed, taken from
  // the rows locked here and nowhere else.
  private async markDeleted(
    tx: Prisma.TransactionClient,
    messageId: string,
    userId: string,
  ): Promise<string[]> {
    const locked = await lockMessage(tx, messageId);
    if (locked.deletedAt) throw new ConflictException(DELETED_MESSAGE);
    const files = await tx.file.findMany({
      where: { messageId },
      select: { id: true, storageKey: true },
    });
    await tx.file.deleteMany({
      where: { id: { in: files.map((file) => file.id) } },
    });
    await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return files.map((file) => file.storageKey);
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

// Holds the message's row until the transaction ends. Answers it as it is
// now, or "not found" if a delete of its chat got there first.
async function lockMessage(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<{ deletedAt: Date | null }> {
  await tx.$queryRaw`SELECT id FROM messages WHERE id = ${messageId}::uuid FOR UPDATE`;
  const message = await tx.message.findUnique({
    where: { id: messageId },
    select: { deletedAt: true },
  });
  if (!message) throw new NotFoundException('Message not found');
  return message;
}

async function refuseBlankWithoutFiles(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<void> {
  const files = await tx.file.count({ where: { messageId } });
  if (files === 0) throw new BadRequestException(MESSAGE_BLANK_MESSAGE);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
