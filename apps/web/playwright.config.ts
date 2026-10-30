import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Browser tests: the real web app, served by the real API, on a real
// database. They use the test database (TEST_DATABASE_URL in
// apps/api/.env, or set by CI), never the development one.
if (existsSync('../api/.env')) {
  process.loadEnvFile('../api/.env')
}
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.',
  )
}

// Not 3000, so a development API can keep running alongside.
const port = 3100

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Builds everything, brings the test database up to date, then starts
  // the API, which also serves the built web app (docs/adr/0001).
  webServer: {
    command: [
      'npm run build -w packages/shared',
      'npm run build -w apps/web',
      'npm run build -w apps/api',
      'npm exec -w apps/api -- prisma migrate deploy',
      'npm run start:prod -w apps/api',
    ].join(' && '),
    cwd: '../..',
    url: `http://localhost:${port}/api`,
    env: { DATABASE_URL: databaseUrl, PORT: String(port) },
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
