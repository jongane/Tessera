import type { Readable } from 'node:stream';

// Where the bytes of files are kept. Everything that stores, reads or
// deletes a file goes through this small interface, so another place (a
// folder on the server's disk, later) can be added without touching the
// rest (docs/adr/0003). The S3 version is s3-file-store.ts.
export interface FileStore {
  // Reads `body` to the end and keeps it under `key`.
  put(key: string, body: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

// The name the app asks Nest for the store under.
export const FILE_STORE = Symbol('FILE_STORE');
