// Points tests at the test database (TEST_DATABASE_URL), never the
// development one, because tests delete data.
import { config } from 'dotenv';

export function testDatabaseUrl(): string {
  // Values already set (for example by CI) win over the .env file.
  config({ quiet: true });
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.',
    );
  }
  return url;
}

// The storage settings the end-to-end tests pass to the API: the S3_*
// settings from the environment or .env, but with the bucket of the tests
// (TEST_S3_BUCKET), never the development one. Without TEST_S3_BUCKET the
// bucket is left as it is, so tests that do not touch files still start;
// the file tests check TEST_S3_BUCKET themselves (see support/storage.ts).
export function testStorageEnv(): Record<string, string> {
  config({ quiet: true });
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('S3_') && value !== undefined) env[name] = value;
  }
  const bucket = process.env['TEST_S3_BUCKET'];
  if (bucket) env['S3_BUCKET'] = bucket;
  return env;
}
