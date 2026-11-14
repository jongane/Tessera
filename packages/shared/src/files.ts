import { z } from 'zod';
import { textWithoutNul } from './text.js';

export const FILE_NAME_MAX = 255;

// The name a file is stored under: what the browser sent, with any folder
// part removed (either kind of slash), spaces at both ends dropped, and 1 to
// 255 characters left. Letters from any language and emoji are kept.
export const fileNameSchema = textWithoutNul()
  .transform((name) => name.slice(name.search(/[^/\\]*$/)).trim())
  .pipe(
    z
      .string()
      .min(1, 'This can’t be empty')
      .max(FILE_NAME_MAX, `Use at most ${FILE_NAME_MAX} characters`),
  );

// The only types a file is ever shown as (inline).
export const IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(type: string): type is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

// Reads a file's first bytes to tell whether it is a PNG, JPEG, GIF or WebP
// image. The name and the type the browser claims are never used.
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    startsWith(bytes, ascii('GIF87a')) ||
    startsWith(bytes, ascii('GIF89a'))
  ) {
    return 'image/gif';
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return 'image/webp';
  }
  return null;
}

// The most bytes detectImageType needs to look at.
export const IMAGE_SIGNATURE_BYTES = 12;

// "12 bytes", "340 KB", "2.4 MB", using 1024 like Windows does.
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
