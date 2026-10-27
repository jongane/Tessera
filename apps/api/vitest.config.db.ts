import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/support/test-env.js';

// Database tests run against a real PostgreSQL (see docker-compose.yml).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-spec.ts'],
    env: { DATABASE_URL: testDatabaseUrl() },
    globalSetup: ['./test/support/migrate-test-database.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
