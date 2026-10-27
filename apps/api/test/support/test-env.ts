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
