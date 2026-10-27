// Vitest global setup: brings the test database up to the latest
// migration once, before any test file runs.
import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-env.js';

export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
