import { defineConfig } from 'vitest/config';
import { testDatabaseUrl, testStorageEnv } from './test/support/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The test files share one database, so they run one at a time.
    fileParallelism: false,
    // The whole app starts in these tests, so it needs the test database.
    env: { DATABASE_URL: testDatabaseUrl(), ...testStorageEnv() },
    globalSetup: ['./test/support/migrate-test-database.ts'],
  },
});
