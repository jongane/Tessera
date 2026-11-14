import type { Readable } from 'node:stream';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type CardFile,
  type CardFileList,
  detectImageType,
  isImageType,
} from '@tessera/shared';
import { recordActivity } from '../activity/activity.js';
import type { SignedInUser } from '../auth/signed-in-user.js';
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

const FILE_NOT_FOUND = 'File not found';
const NOT_ALLOWED_TO_REMOVE =
  'Only the person who added a file or a project admin can remove it';

const withPeople = {
  uploader: { select: { id: true, displayName: true } },
  message: { select: { chatId: true } },
} satisfies Prisma.FileInclude;

type FileWithPeople = Prisma.FileGetPayload<{ include: typeof withPeople }>;

// Files on cards: keeping, listing, reading and removing them. The bytes are
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
  ): Promise<CardFile> {
    const card = await findVisibleCard(this.prisma, user.id, cardId);
    refuseAnnouncedSize(req, this.limit);
    const upload = await readUpload(req, this.store, this.limit);
    try {
      const row = await this.prisma.$transaction((tx) =>
        this.saveRow(tx, card, user.id, upload),
      );
      return toCardFile(row);
    } catch (error) {
      await this.deleteObject(upload.storageKey);
      throw error;
    }
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

  async list(user: SignedInUser, cardId: string): Promise<CardFileList> {
    const card = await findVisibleCard(this.prisma, user.id, cardId);
    const rows = await this.prisma.file.findMany({
      where: { cardId: card.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: withPeople,
    });
    return { files: rows.map(toCardFile) };
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

  // The uploader or a project admin. The row and its history line go first
  // and the object after: if the object cannot be deleted, nobody can reach
  // it any more, and the person still sees the file gone.
  async remove(user: SignedInUser, fileId: string): Promise<void> {
    const file = await this.findVisible(user.id, fileId);
    await this.checkMayRemove(user.id, file);
    await this.prisma.$transaction(async (tx) => {
      if (file.cardId) {
        // Waits for a delete of the card that is running.
        await tx.$queryRaw`SELECT id FROM cards WHERE id = ${file.cardId}::uuid FOR UPDATE`;
      }
      // Of two removals at once, only one finds the row.
      const { count } = await tx.file.deleteMany({ where: { id: file.id } });
      if (count === 0) {
        throw new NotFoundException(FILE_NOT_FOUND);
      }
      if (file.cardId) {
        await recordActivity(
          tx,
          { id: file.cardId, projectId: file.projectId },
          user.id,
          'FILE_REMOVED',
          fileRef(file),
        );
      }
    });
    await this.deleteObject(file.storageKey);
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
      where: { id: fileId, project: { members: { some: { userId } } } },
    });
    if (!file) {
      throw new NotFoundException(FILE_NOT_FOUND);
    }
    return file;
  }

  private async checkMayRemove(userId: string, file: File): Promise<void> {
    if (file.uploaderId === userId) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: file.projectId, userId } },
    });
    if (membership?.role !== 'ADMIN') {
      throw new ForbiddenException(NOT_ALLOWED_TO_REMOVE);
    }
  }
}

function fileRef(file: Pick<File, 'id' | 'name' | 'size'>) {
  return { fileId: file.id, name: file.name, size: Number(file.size) };
}

function toCardFile(file: FileWithPeople): CardFile {
  return {
    id: file.id,
    name: file.name,
    size: Number(file.size),
    isImage: isImageType(file.mimeType),
    uploader: file.uploader,
    createdAt: file.createdAt.toISOString(),
    messageId: file.messageId,
    chatId: file.message?.chatId ?? null,
  };
}

function isMissingObject(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  return e.name === 'NoSuchKey' || e.message === 'NoSuchKey';
}
