import { readFileSizeLimit, readStorageSettings } from './storage-settings.js';

// Files on cards, PR A, "Storage setup" (acceptance criteria 2 and 4).
//
// Contract these tests assume, in apps/api/src/storage/storage-settings.ts
// (the plan names the file; the function names and result fields are the
// tester's choice, to be confirmed):
//   readStorageSettings(env): { endpoint, region, bucket, accessKeyId,
//     secretAccessKey, forcePathStyle: boolean }
//     reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
//     S3_SECRET_ACCESS_KEY and S3_FORCE_PATH_STYLE ('true' or 'false').
//     Throws an Error naming the first variable that is missing.
//   readFileSizeLimit(env): the largest file in bytes, from
//     FILE_SIZE_LIMIT_MB (1 MB = 1,048,576 bytes); 100 MB when left out;
//     throws an Error naming FILE_SIZE_LIMIT_MB when the value is not a
//     whole number from 1 to 10,240.
const MB = 1_048_576;

const complete = {
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'tessera-dev',
  S3_ACCESS_KEY_ID: 'local-key',
  S3_SECRET_ACCESS_KEY: 'local-secret',
  S3_FORCE_PATH_STYLE: 'true',
};

describe('readStorageSettings', () => {
  // 2
  it('reads the six settings', () => {
    expect(readStorageSettings({ ...complete })).toMatchObject({
      endpoint: 'http://localhost:8333',
      region: 'us-east-1',
      bucket: 'tessera-dev',
      accessKeyId: 'local-key',
      secretAccessKey: 'local-secret',
      forcePathStyle: true,
    });
    expect(
      readStorageSettings({ ...complete, S3_FORCE_PATH_STYLE: 'false' })
        .forcePathStyle,
    ).toBe(false);
  });

  // 2
  it.each(Object.keys(complete))(
    'refuses to start without %s, naming it',
    (name) => {
      const env: Record<string, string | undefined> = { ...complete };
      delete env[name];
      expect(() => readStorageSettings(env)).toThrow(name);
    },
  );

  // 2
  it('treats an empty setting as missing', () => {
    expect(() => readStorageSettings({ ...complete, S3_BUCKET: '' })).toThrow(
      'S3_BUCKET',
    );
  });

  // 2 (risk 10: the settings never appear in an error message)
  it('does not put the secret in the message of its error', () => {
    const env: Record<string, string | undefined> = { ...complete };
    delete env['S3_REGION'];
    expect(() => readStorageSettings(env)).toThrow(/S3_REGION/);
    try {
      readStorageSettings(env);
    } catch (error) {
      expect((error as Error).message).not.toContain('local-secret');
    }
  });
});

describe('readFileSizeLimit', () => {
  // 4
  it('is 100 MB when FILE_SIZE_LIMIT_MB is left out', () => {
    expect(readFileSizeLimit({})).toBe(100 * MB);
    expect(readFileSizeLimit({ FILE_SIZE_LIMIT_MB: undefined })).toBe(100 * MB);
  });

  // 4
  it.each([
    ['1', 1 * MB],
    ['25', 25 * MB],
    ['100', 100 * MB],
    ['10240', 10_240 * MB],
  ])('reads %j as that many megabytes of 1,048,576 bytes', (value, bytes) => {
    expect(readFileSizeLimit({ FILE_SIZE_LIMIT_MB: value })).toBe(bytes);
  });

  // 4
  it.each(['0', '-1', '10241', '1.5', 'abc', '100MB', 'NaN', 'Infinity'])(
    'refuses %j instead of falling back, saying FILE_SIZE_LIMIT_MB',
    (value) => {
      expect(() => readFileSizeLimit({ FILE_SIZE_LIMIT_MB: value })).toThrow(
        'FILE_SIZE_LIMIT_MB',
      );
    },
  );
});
