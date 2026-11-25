import { type FileInfo, isImageType } from '@tessera/shared';
import type { File, Prisma } from '../generated/prisma/client.js';

// A file with the person who added it: what every answer about files needs.
export const withUploader = {
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.FileInclude;

export type FileWithUploader = Prisma.FileGetPayload<{
  include: typeof withUploader;
}>;

// Files in the order they were added.
export const inUploadOrder = [
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.FileOrderByWithRelationInput[];

// `chatId` is the chat of the file's message; a pending file knows its own.
export function toFileInfo(
  file: FileWithUploader,
  chatId: string | null,
): FileInfo {
  return {
    id: file.id,
    name: file.name,
    size: Number(file.size),
    isImage: isImageType(file.mimeType),
    uploader: file.uploader,
    createdAt: file.createdAt.toISOString(),
    messageId: file.messageId,
    chatId: file.pendingChatId ?? chatId,
    pending: file.pendingChatId !== null,
  };
}

export function fileRef(file: Pick<File, 'id' | 'name' | 'size'>) {
  return { fileId: file.id, name: file.name, size: Number(file.size) };
}
