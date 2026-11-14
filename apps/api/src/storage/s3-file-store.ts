import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { FileStore } from './file-store.js';
import type { StorageSettings } from './storage-settings.js';

// Keeps files in any S3-compatible store (SeaweedFS, MinIO, AWS S3).
export class S3FileStore implements FileStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(settings: StorageSettings) {
    this.bucket = settings.bucket;
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  // Makes the bucket if it is not there yet, and leaves an existing one alone.
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  // Streams the body on in parts, so a big file is never held whole in memory.
  async put(key: string, body: Readable): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
    });
    await upload.done();
  }

  async get(key: string): Promise<Readable> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return object.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function isMissing(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.$metadata?.httpStatusCode === 404 ||
    e.name === 'NotFound' ||
    e.name === 'NoSuchBucket'
  );
}
