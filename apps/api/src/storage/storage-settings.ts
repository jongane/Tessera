// The settings for file storage, read once when the API starts from
// environment variables (apps/api/.env.example lists them). A missing or
// wrong one stops the API from starting, with a message that names it. The
// messages never hold a setting's value, so a secret cannot leak.

export interface StorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // True for SeaweedFS and MinIO (the bucket is in the path).
  forcePathStyle: boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set (see apps/api/.env.example)`);
  }
  return value;
}

export function readStorageSettings(env: Env): StorageSettings {
  const forcePathStyle = required(env, 'S3_FORCE_PATH_STYLE');
  if (forcePathStyle !== 'true' && forcePathStyle !== 'false') {
    throw new Error('S3_FORCE_PATH_STYLE must be "true" or "false"');
  }
  return {
    endpoint: required(env, 'S3_ENDPOINT'),
    region: required(env, 'S3_REGION'),
    bucket: required(env, 'S3_BUCKET'),
    accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
    forcePathStyle: forcePathStyle === 'true',
  };
}

const BYTES_PER_MB = 1_048_576;
const DEFAULT_LIMIT_MB = 100;
const MAX_LIMIT_MB = 10_240;

// The largest file in bytes, from FILE_SIZE_LIMIT_MB (a whole number of
// megabytes, 1 to 10,240; 100 when left out). A value that is not that
// refuses to start, so a typo never changes the limit quietly.
export function readFileSizeLimit(env: Env): number {
  const value = env['FILE_SIZE_LIMIT_MB'];
  if (value === undefined || value === '') {
    return DEFAULT_LIMIT_MB * BYTES_PER_MB;
  }
  const megabytes = /^[0-9]{1,5}$/.test(value) ? Number(value) : NaN;
  if (!(megabytes >= 1 && megabytes <= MAX_LIMIT_MB)) {
    throw new Error(
      `FILE_SIZE_LIMIT_MB must be a whole number from 1 to ${MAX_LIMIT_MB}`,
    );
  }
  return megabytes * BYTES_PER_MB;
}
