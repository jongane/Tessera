import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Talks to the real SeaweedFS (or any S3 store) the file tests use, with its
// own small S3 client (Signature Version 4), so a test checks the store
// without going through the code under test. The settings are the ones the
// API reads (S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY),
// from the environment or apps/api/.env. The bucket is TEST_S3_BUCKET, never
// the development one.

interface Settings {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy apps/api/.env.example to apps/api/.env and start SeaweedFS (docker compose up -d).`,
    );
  }
  return value;
}

export function testBucket(): string {
  return need('TEST_S3_BUCKET');
}

function settings(bucket = testBucket()): Settings {
  return {
    endpoint: need('S3_ENDPOINT').replace(/\/$/, ''),
    region: need('S3_REGION'),
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    bucket,
  };
}

const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encode = (part: string) =>
  encodeURIComponent(part).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

// One signed request, path style: /bucket/key.
async function s3(
  bucket: string,
  method: string,
  key: string,
  options: { query?: Record<string, string>; body?: Buffer } = {},
): Promise<Response> {
  const s = settings(bucket);
  const url = new URL(s.endpoint);
  const path =
    '/' + [s.bucket, ...key.split('/').filter(Boolean)].map(encode).join('/');
  const query = Object.entries(options.query ?? {})
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const body = options.body ?? Buffer.alloc(0);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    query,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${s.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join(
    '\n',
  );
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${s.secretAccessKey}`, day), s.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(toSign)
    .digest('hex');
  return fetch(`${s.endpoint}${path}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    body:
      method === 'PUT' && body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

// The keys of every object in a bucket (the test bucket unless given).
export async function listKeys(bucket = testBucket()): Promise<string[]> {
  const response = await s3(bucket, 'GET', '', {
    query: { 'list-type': '2' },
  });
  // No bucket yet (the API makes it when it starts): no objects.
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Listing ${bucket} gave ${response.status}`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]!);
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await s3(testBucket(), 'HEAD', key);
  return response.status === 200;
}

export async function getObject(
  key: string,
  bucket = testBucket(),
): Promise<Buffer | null> {
  const response = await s3(bucket, 'GET', key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Getting ${key} gave ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function putObject(
  key: string,
  data: Buffer,
  bucket = testBucket(),
): Promise<void> {
  const response = await s3(bucket, 'PUT', key, { body: data });
  if (!response.ok) throw new Error(`Putting ${key} gave ${response.status}`);
}

export async function createBucket(bucket: string): Promise<void> {
  const response = await s3(bucket, 'PUT', '');
  if (!response.ok) {
    throw new Error(`Making bucket ${bucket} gave ${response.status}`);
  }
}

export async function bucketExists(bucket: string): Promise<boolean> {
  const response = await s3(bucket, 'HEAD', '');
  return response.status === 200;
}

// Deletes every object (so the next test starts with an empty store).
export async function emptyBucket(bucket = testBucket()): Promise<void> {
  for (const key of await listKeys(bucket)) {
    await s3(bucket, 'DELETE', key);
  }
}

export async function deleteBucket(bucket: string): Promise<void> {
  await emptyBucket(bucket);
  await s3(bucket, 'DELETE', '');
}

// A row in the files table and its object, written straight into the
// database and the store, for tests that need a file in a state the API
// does not make (a deleted uploader, a name with odd characters, a stored
// type). Returns the row's id and storage key.
export async function seedFile(
  prisma: PrismaService,
  file: {
    projectId: string;
    cardId: string;
    uploaderId: string | null;
    name: string;
    bytes: Buffer;
    mimeType?: string;
  },
): Promise<{ id: string; storageKey: string }> {
  const id = randomUUID();
  const storageKey = `files/${randomUUID()}`;
  await putObject(storageKey, file.bytes);
  await prisma.$executeRaw`
    INSERT INTO files (id, project_id, card_id, uploader_id, name, size,
                       mime_type, storage_key, created_at)
    VALUES (${id}::uuid, ${file.projectId}::uuid, ${file.cardId}::uuid,
            ${file.uploaderId}::uuid, ${file.name}, ${file.bytes.length},
            ${file.mimeType ?? 'application/octet-stream'}, ${storageKey},
            now())`;
  return { id, storageKey };
}
