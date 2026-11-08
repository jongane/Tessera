import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import { resetDatabase } from './support/reset-database.js';
import { startTestApp } from './support/test-app.js';

// Antagonist proof tests for the NUL refusal (plan "refuse NUL characters in
// text fields", criterion 3: "never 500").

// 50 000 nested arrays: about 100 kB, just under the JSON body limit.
function deeplyNestedJson(depth = 50_000): string {
  return '['.repeat(depth) + ']'.repeat(depth);
}

describe('NUL refusal attacks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await startTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a deeply nested JSON body to sign-in with 400, not 500', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set('Content-Type', 'application/json')
      .send(deeplyNestedJson());

    expect(response.status).toBe(400);
  });

  it('answers a deeply nested JSON body to a card change with 400, not 500', async () => {
    const { ana, cardUrl } = await boardScenario(app);

    const response = await ana.agent
      .patch(cardUrl)
      .set('Content-Type', 'application/json')
      .send(deeplyNestedJson());

    expect(response.status).toBe(400);
  });

  // Decided: the sign-in check runs first, so someone who is not signed in
  // gets 401 for a NUL in the URL of a non-public route.
  it('answers a NUL in the URL with 401 when not signed in', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/projects/by-code/WE%00B',
    );

    expect(response.status).toBe(401);
  });
});
