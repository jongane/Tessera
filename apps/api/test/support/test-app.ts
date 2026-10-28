import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

// The whole API, set up as main.ts does, for end-to-end tests.
export async function startTestApp(): Promise<{
  app: INestApplication<App>;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export const testPassword = 'a long enough password';

// A browser with its own cookies, signed up as `name`.
export async function signedUpAs(app: INestApplication<App>, name: string) {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/auth/sign-up')
    .send({
      email: `${name}@example.com`,
      displayName: name,
      password: testPassword,
    })
    .expect(201);
  return { agent, user: response.body as { id: string; email: string } };
}
