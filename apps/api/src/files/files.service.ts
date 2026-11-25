import type { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type CardFileList,
  detectImageType,
  type FileInfo,
  isImageType,
  MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE,
  MESSAGE_FILES_MAX,
  MESSAGE_NEEDS_TEXT_OR_FILE_MESSAGE,
  MESSAGE_TOO_MANY_FILES_MESSAGE,
} from '@tessera/shared';
import { recordActivity } from '../activity/activity.js';
import type { SignedInUser } from '../auth/signed-in-user.js';
import { boardsVisibleTo } from '../boards/board-access.js';
import { findVisibleCard } from '../cards/card-access.js';
import type { File, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILE_STORE, type FileStore } from '../storage/file-store.js';
import { FILE_SIZE_LIMIT } from '../storage/storage.module.js';
import {
  readUpload,
  refuseAnnouncedSize,
  type StoredUpload,
} from './read-upload.js';
import { retryOnCollision } from '../common/retry-on-collision.js';
import { fileRef, toFileInfo, withUploader } from './file-view.js';

const FILE_NOT_FOUND = 'File not found';
const CHAT_NOT_FOUND = 'Chat not found';
const NOT_ALLOWED_TO_REMOVE =
  'Only the person who added a file or a project admin can remove it';

const withPeople = {
  ...withUploader,
  message: { select: { chatId: true } },
} satisfies Prisma.FileInclude;

type FileWithPeople = Prisma.FileGetPayload<{ include: typeof withPeople }>;

// Files on cards and in chats: keeping, listing, reading and removing them. The bytes are
// in the file store and the rows are the only way to reach them, so every
// read and every delete starts from a row the person may see.
@Injectable()
export class FilesService {
  private readonly log = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORE) private readonly store: FileStore,
    @Inject(FILE_SIZE_LIMIT) private readonly limit: number,
  ) {}

  // Stores the file of an upload on the card. The object is stored first and
  // then the row; if the row cannot be saved, the object is deleted again.
  async attach(
    user: SignedInUser,
    cardId: string,
    req: Request,
  ): Promise<FileInfo> {
    const card = await findVisibleCard(this.prisma, user.id, cardId);
    refuseAnnouncedSize(req, this.limit);
    const upload = await readUpload(req, this.store, this.limit);
    try {
      const row = await retryOnCollision(() =>
        this.prisma.$transaction((tx) =>
          this.saveRow(tx, card, user.id, upload),
        ),
      );
      return toFileInfo(row, null);
    } catch (error) {
      await this.deleteObject(upload.storageKey);
      throw error;
    }
  }

  // Stores the file of an upload into the message box of a chat, as a
  // pending file: only its uploader sees it until a message is sent with it.
  async attachPending(
    user: SignedInUser,
    chatId: string,
    req: Request,
  ): Promise<FileInfo> {
    const chat = await this.findVisibleChat(user.id, chatId);
    await refuseTooManyPending(this.prisma, chat.id, user.id);
    refuseAnnouncedSize(req, this.limit);
    const upload = await readUpload(req, this.store, this.limit);
    try {
      const row = await retryOnCollision(
        () =>
          this.prisma.$transaction((tx) =>
            this.savePending(tx, chat, user.id, upload),
          ),
        { message: MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE },
      );
      return toFileInfo(row, chat.id);
    } catch (error) {
      await this.deleteObject(upload.storageKey);
      throw error;
    }
  }

  private async findVisibleChat(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, board: boardsVisibleTo(userId) },
      select: { id: true, board: { select: { projectId: true } } },
    });
    if (!chat) throw new NotFoundException(CHAT_NOT_FOUND);
    return { id: chat.id, projectId: chat.board.projectId };
  }

  private async savePending(
    tx: Prisma.TransactionClient,
    chat: { id: string; projectId: string },
    userId: string,
    upload: StoredUpload,
  ): Promise<FileWithPeople> {
    // Held only against other uploads (and a delete of the chat), so two
    // uploads at once cannot both take the last place.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM chats WHERE id = ${chat.id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw new NotFoundException(CHAT_NOT_FOUND);
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: chat.projectId, userId } },
    });
    if (!member) throw new NotFoundException(CHAT_NOT_FOUND);
    await refuseTooManyPending(tx, chat.id, userId);
    return tx.file.create({
      data: {
        projectId: chat.projectId,
        pendingChatId: chat.id,
        uploaderId: userId,
        name: upload.name,
        size: upload.size,
        mimeType: detectImageType(upload.head) ?? 'application/octet-stream',
        storageKey: upload.storageKey,
      },
      include: withPeople,
    });
  }

  private async saveRow(
    tx: Prisma.TransactionClient,
    card: { id: string; projectId: string },
    userId: string,
    upload: StoredUpload,
  ): Promise<FileWithPeople> {
    // Waits for a delete of the card that is running, then sees it gone.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM cards WHERE id = ${card.id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException('Card not found');
    }
    const member = await tx.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: card.projectId, userId },
      },
    });
    if (!member) {
      throw new NotFoundException('Card not found');
    }
    const row = await tx.file.create({
      data: {
        projectId: card.projectId,
        cardId: card.id,
        uploaderId: userId,
        name: upload.name,
        size: upload.size,
        mimeType: detectImageType(upload.head) ?? 'application/octet-stream',
        storageKey: upload.storageKey,
      },
      include: withPeople,
    });
    await recordActivity(tx, card, userId, 'FILE_ADDED', fileRef(row));
    return row;
  }

  // The caller's own pending files in a chat, oldest first.
  async listPending(user: SignedInUser, chatId: string): Promise<CardFileList> {
    const chat = await this.findVisibleChat(user.id, chatId);
    const rows = await this.prisma.file.findMany({
      where: { pendingChatId: chat.id, uploaderId: user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: withPeople,
    });
    return { files: rows.map((row) => toFileInfo(row, chat.id)) };
  }

  // The card's own files and the files of messages in the card's chat.
  async list(user: SignedInUser, cardId: string): Promise<CardFileList> {
    const card = await findVisibleCard(this.prisma, user.id, cardId);
    const rows = await this.prisma.file.findMany({
      where: {
        OR: [{ cardId: card.id }, { message: { chat: { cardId: card.id } } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: withPeople,
    });
    return {
      files: rows.map((row) => toFileInfo(row, row.message?.chatId ?? null)),
    };
  }

  // The file and its bytes, for a download or an inline preview. `inline`
  // is only ever true for an image the API recognised by its first bytes.
  async open(
    user: SignedInUser,
    fileId: string,
    inline: boolean,
  ): Promise<{ file: File; body: Readable }> {
    const file = await this.findVisible(user.id, fileId);
    if (inline && !isImageType(file.mimeType)) {
      throw new NotFoundException(FILE_NOT_FOUND);
    }
    try {
      return { file, body: await this.store.get(file.storageKey) };
    } catch (error) {
      // Removed while this was being asked for.
      if (isMissingObject(error)) throw new NotFoundException(FILE_NOT_FOUND);
      throw error;
    }
  }

  // The uploader or a project admin (only the uploader, for a pending file).
  // The row and its history line go first and the object after: if the
  // object cannot be deleted, nobody can reach it any more, and the person
  // still sees the file gone.
  async remove(user: SignedInUser, fileId: string): Promise<void> {
    const visible = await this.findVisible(user.id, fileId);
    const file = await retryOnCollision(
      () =>
        this.prisma.$transaction((tx) =>
          this.removeRow(tx, user.id, visible.id),
        ),
      visible.cardId
        ? undefined
        : { message: MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE },
    );
    await this.deleteObject(file.storageKey);
  }

  private async removeRow(
    tx: Prisma.TransactionClient,
    userId: string,
    fileId: string,
  ): Promise<File> {
    // Of two removals at once, only one finds the row.
    const owner = await lockFileAndOwner(tx, fileId);
    const file = await tx.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(FILE_NOT_FOUND);
    await this.checkMayRemove(tx, userId, file);
    if (owner.kind === 'message') {
      await refuseLastFileOfBlankMessage(tx, owner.messageId, file.id);
    }
    await tx.file.delete({ where: { id: file.id } });
    if (owner.kind === 'card') {
      await recordActivity(
        tx,
        { id: owner.cardId, projectId: file.projectId },
        userId,
        'FILE_REMOVED',
        fileRef(file),
      );
    }
    return file;
  }

  // Deletes the objects of files whose rows are already gone. A failure is
  // logged, never shown: the objects can no longer be reached.
  async deleteObjects(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      await this.deleteObject(key);
    }
  }

  private async deleteObject(storageKey: string): Promise<void> {
    try {
      await this.store.delete(storageKey);
    } catch (error) {
      this.log.error(
        `Could not delete the stored file ${storageKey}: ${String(error)}`,
      );
    }
  }

  // A file in a project the person belongs to. Any other is "not found", so
  // nobody can tell whether it exists.
  private async findVisible(userId: string, fileId: string): Promise<File> {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        project: { members: { some: { userId } } },
        // A pending file is seen by the person who uploaded it only.
        OR: [{ pendingChatId: null }, { uploaderId: userId }],
      },
    });
    if (!file) {
      throw new NotFoundException(FILE_NOT_FOUND);
    }
    return file;
  }

  private async checkMayRemove(
    tx: Prisma.TransactionClient,
    userId: string,
    file: File,
  ): Promise<void> {
    const membership = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: file.projectId, userId } },
    });
    // Removed from the project while this waited: like any outsider.
    if (!membership) {
      throw new NotFoundException(
        file.cardId ? 'Card not found' : FILE_NOT_FOUND,
      );
    }
    if (file.uploaderId === userId) return;
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException(NOT_ALLOWED_TO_REMOVE);
    }
  }
}

type FileOwner =
  | { kind: 'card'; cardId: string }
  | { kind: 'message'; messageId: string }
  | { kind: 'pending' };

interface OwnerColumns {
  card_id: string | null;
  message_id: string | null;
}

async function readOwnerColumns(
  tx: Prisma.TransactionClient,
  fileId: string,
  lock: boolean,
): Promise<OwnerColumns> {
  const rows = lock
    ? await tx.$queryRaw<
        OwnerColumns[]
      >`SELECT card_id, message_id FROM files WHERE id = ${fileId}::uuid FOR UPDATE`
    : await tx.$queryRaw<
        OwnerColumns[]
      >`SELECT card_id, message_id FROM files WHERE id = ${fileId}::uuid`;
  if (rows.length === 0) throw new NotFoundException(FILE_NOT_FOUND);
  return rows[0]!;
}

// Locks what holds the file (its card or its message), then the file, and
// answers what holds it. The card or message is locked first (as a delete of
// it does), so the two never wait on each other. If the file moved meanwhile
// (a pending file was sent), tries again.
async function lockFileAndOwner(
  tx: Prisma.TransactionClient,
  fileId: string,
): Promise<FileOwner> {
  for (;;) {
    const seen = await readOwnerColumns(tx, fileId, false);
    if (seen.card_id) {
      await tx.$queryRaw`SELECT id FROM cards WHERE id = ${seen.card_id}::uuid FOR UPDATE`;
    } else if (seen.message_id) {
      await tx.$queryRaw`SELECT id FROM messages WHERE id = ${seen.message_id}::uuid FOR UPDATE`;
    }
    const now = await readOwnerColumns(tx, fileId, true);
    if (now.card_id === seen.card_id && now.message_id === seen.message_id) {
      if (now.card_id) return { kind: 'card', cardId: now.card_id };
      if (now.message_id) return { kind: 'message', messageId: now.message_id };
      return { kind: 'pending' };
    }
  }
}

// A message with no text keeps at least one file (delete the message
// instead). The message is locked, so two removals at once cannot both pass.
async function refuseLastFileOfBlankMessage(
  tx: Prisma.TransactionClient,
  messageId: string,
  fileId: string,
): Promise<void> {
  const message = await tx.message.findUnique({
    where: { id: messageId },
    select: { body: true },
  });
  if (!message || message.body.trim() !== '') return;
  const others = await tx.file.count({
    where: { messageId, id: { not: fileId } },
  });
  if (others === 0) {
    throw new BadRequestException(MESSAGE_NEEDS_TEXT_OR_FILE_MESSAGE);
  }
}

async function refuseTooManyPending(
  db: Pick<Prisma.TransactionClient, 'file'>,
  chatId: string,
  userId: string,
): Promise<void> {
  const pending = await db.file.count({
    where: { pendingChatId: chatId, uploaderId: userId },
  });
  if (pending >= MESSAGE_FILES_MAX) {
    throw new ConflictException(MESSAGE_TOO_MANY_FILES_MESSAGE);
  }
}

function isMissingObject(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  return e.name === 'NoSuchKey' || e.message === 'NoSuchKey';
}
