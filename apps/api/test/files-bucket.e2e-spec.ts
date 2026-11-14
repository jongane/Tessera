import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { startTestApp } from './support/test-app.js';
import {
  bucketExists,
  createBucket,
  deleteBucket,
  getObject,
  putObject,
  testBucket,
} from './support/storage.js';

// Files on cards, PR A, "Storage setup" (acceptance criterion 3): the API
// makes its bucket when it starts if it is not there, and leaves an existing
// bucket alone. Each test uses a bucket of its own, named after
// TEST_S3_BUCKET, which the test removes afterwards.
describe('The bucket at start (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let bucket: string;
  let before: string | undefined;

  beforeEach(() => {
    before = process.env['S3_BUCKET'];
    bucket = `${testBucket()}-start-${randomUUID().slice(0, 8)}`;
    process.env['S3_BUCKET'] = bucket;
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    process.env['S3_BUCKET'] = before;
    if (await bucketExists(bucket)) await deleteBucket(bucket);
  });

  // 3
  it('makes the bucket when it is not there yet', async () => {
    expect(await bucketExists(bucket)).toBe(false);

    ({ app } = await startTestApp());

    expect(await bucketExists(bucket)).toBe(true);
  });

  // 3
  it('leaves an existing bucket and what is in it alone', async () => {
    await createBucket(bucket);
    await putObject('files/keep-me', Buffer.from('kept'), bucket);

    ({ app } = await startTestApp());

    expect(await bucketExists(bucket)).toBe(true);
    expect(await getObject('files/keep-me', bucket)).toEqual(
      Buffer.from('kept'),
    );
  });

  // 3
  it('starts again on the bucket it made, keeping what was stored in it', async () => {
    ({ app } = await startTestApp());
    expect(await bucketExists(bucket)).toBe(true);
    await putObject('files/keep-me', Buffer.from('kept'), bucket);
    await app.close();

    ({ app } = await startTestApp());

    expect(await getObject('files/keep-me', bucket)).toEqual(
      Buffer.from('kept'),
    );
  });
});
