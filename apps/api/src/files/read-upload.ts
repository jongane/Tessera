import { randomUUID } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import {
  BadRequestException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import busboy from 'busboy';
import type { Request } from 'express';
import {
  fileNameSchema,
  hasNul,
  IMAGE_SIGNATURE_BYTES,
  NUL_MESSAGE,
} from '@tessera/shared';
import type { FileStore } from '../storage/file-store.js';

const log = new Logger('Files');

export const ATTACH_ONE_FILE = 'Attach one file';
export const ATTACH_ONE_AT_A_TIME = 'Attach one file at a time';

// The form around a file (boundary, headers, the name) is not counted
// against the size limit, so the announced size may be a little over it.
const FORM_ALLOWANCE = 64 * 1024;

export function tooBig(limit: number) {
  return new PayloadTooLargeException(
    `Files can be at most ${limit / 1_048_576} MB`,
  );
}

// Refuses early when the browser says the upload is too big. The announced
// size is never trusted on its own: readUpload counts the real bytes.
export function refuseAnnouncedSize(req: Request, limit: number): void {
  const announced = Number(req.headers['content-length']);
  if (announced > limit + FORM_ALLOWANCE) {
    throw tooBig(limit);
  }
}

const MAX_HEADER_SIZE = 16 * 1024;

// The header of the form's first part: the text before the first empty line.
function headerOf(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  return end === -1 ? text : text.slice(0, end);
}

export interface StoredUpload {
  storageKey: string;
  name: string;
  size: number;
  // The first bytes, for telling an image from anything else.
  head: Buffer;
}

// Counts the bytes that pass and keeps the first few, and stops the upload
// as soon as it passes the limit.
class Gauge extends Transform {
  size = 0;
  head = Buffer.alloc(0);

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ) {
    if (this.head.length < IMAGE_SIGNATURE_BYTES) {
      this.head = Buffer.concat([this.head, chunk]).subarray(
        0,
        IMAGE_SIGNATURE_BYTES,
      );
    }
    this.size += chunk.length;
    done(this.size > this.limit ? tooBig(this.limit) : null, chunk);
  }
}

// Reads the one file of a multipart form (field "file") and streams it to
// the store as it arrives, so a big file is never held whole in memory.
// Refuses anything else in the form (no file, two files, other fields) and a
// file over `limit` bytes. Whatever it refuses, it leaves nothing stored.
// The caller must have checked who is asking before calling it.
export function readUpload(
  req: Request,
  store: FileStore,
  limit: number,
): Promise<StoredUpload> {
  return new Promise((resolve, reject) => {
    let form: busboy.Busboy;
    try {
      form = busboy({
        headers: req.headers,
        // Names are UTF-8 (busboy's default is Latin-1, which garbles them).
        defParamCharset: 'utf8',
        // The name is cleaned by fileNameSchema, which removes the folder.
        preservePath: true,
        limits: { parts: 3, fieldSize: 1024 },
      });
    } catch {
      reject(new BadRequestException(ATTACH_ONE_FILE));
      return;
    }

    const storageKey = `files/${randomUUID()}`;
    let failure: Error | null = null;
    let gauge: Gauge | null = null;
    let name = '';
    let seenFile = false;
    let stored: Promise<Error | null> | null = null;

    // The first problem is the one reported; the rest of the form is read
    // and thrown away so the browser can still get the answer.
    const fail = (error: Error) => {
      failure ??= error;
      gauge?.destroy(error);
    };

    form.on('field', () => fail(new BadRequestException(ATTACH_ONE_FILE)));
    form.on('partsLimit', () => fail(new BadRequestException(ATTACH_ONE_FILE)));
    // busboy refuses a part whose header holds a NUL (or another control
    // character), such as in the file's name, and then stops reading.
    const firstPartHeader: Buffer[] = [];
    let firstPartHeaderSize = 0;
    req.on('data', (chunk: Buffer) => {
      if (firstPartHeaderSize < MAX_HEADER_SIZE) {
        firstPartHeader.push(chunk);
        firstPartHeaderSize += chunk.length;
      }
    });
    form.on('error', () => {
      fail(
        new BadRequestException(
          hasNul(headerOf(firstPartHeader)) ? NUL_MESSAGE : ATTACH_ONE_FILE,
        ),
      );
      void settle();
    });
    form.on('file', (field, file, info) => {
      const discard = (error: Error) => {
        fail(error);
        file.resume();
      };
      if (field !== 'file') {
        return discard(new BadRequestException(ATTACH_ONE_FILE));
      }
      if (seenFile) {
        return discard(new BadRequestException(ATTACH_ONE_AT_A_TIME));
      }
      seenFile = true;
      const parsed = fileNameSchema.safeParse(info.filename);
      if (!parsed.success) {
        return discard(
          new BadRequestException(parsed.error.issues[0]?.message),
        );
      }
      name = parsed.data;
      const counter = new Gauge(limit);
      gauge = counter;
      file.pipe(counter);
      // After a refusal, keep reading (and dropping) the rest of the file.
      counter.on('error', (error) => {
        failure ??= error;
        file.unpipe(counter);
        file.resume();
      });
      stored = store.put(storageKey, counter).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error : new Error()),
      );
    });

    // The browser went away before the end of the form.
    req.on('close', () => {
      if (!req.readableEnded) {
        fail(new BadRequestException('The upload was cancelled'));
        form.destroy();
      }
    });

    form.on('close', () => {
      void settle();
    });

    let settled = false;
    async function settle() {
      if (settled) return;
      settled = true;
      const putError = stored ? await stored : null;
      const problem = failure ?? putError;
      if (!problem && gauge && stored) {
        resolve({ storageKey, name, size: gauge.size, head: gauge.head });
        return;
      }
      // Stopped part way: whatever the store may hold is removed again.
      if (stored) {
        await store.delete(storageKey).catch((error: unknown) => {
          log.error(`Could not delete ${storageKey} again: ${String(error)}`);
        });
      }
      reject(problem ?? new BadRequestException(ATTACH_ONE_FILE));
    }

    req.pipe(form);
  });
}
