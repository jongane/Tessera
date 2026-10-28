import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDatabase } from './support/reset-database.js';
import { signedUpAs, startTestApp, testPassword } from './support/test-app.js';

describe('Accounts and sign-in (e2e)', () => {
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

  const browser = () => request.agent(app.getHttpServer());

  describe('sign-up', () => {
    it('creates an account, signs it in and keeps the session in a safe cookie', async () => {
      const agent = browser();

      const response = await agent
        .post('/api/auth/sign-up')
        .send({
          email: ' Ana@Example.com ',
          displayName: ' Ana ',
          password: testPassword,
        })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'ana@example.com',
        displayName: 'Ana',
        isServerAdmin: true,
      });
      const cookie = response.headers['set-cookie']![0]!;
      expect(cookie).toMatch(/^tessera_session=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      await agent.get('/api/auth/me').expect(200, response.body);
    });

    it('makes only the first account a server admin', async () => {
      await signedUpAs(app, 'ana');
      const { user } = await signedUpAs(app, 'ben');

      expect(user).toMatchObject({ isServerAdmin: false });
    });

    it('refuses an email that already has an account, in any letter case', async () => {
      await signedUpAs(app, 'ana');

      await browser()
        .post('/api/auth/sign-up')
        .send({
          email: 'ANA@example.com',
          displayName: 'Other Ana',
          password: testPassword,
        })
        .expect(409);
    });

    it('refuses bad input with a clear message', async () => {
      const good = {
        email: 'ana@example.com',
        displayName: 'Ana',
        password: testPassword,
      };
      for (const bad of [
        { ...good, email: 'not an email' },
        { ...good, displayName: ' ' },
        { ...good, password: 'too short' },
        { ...good, isServerAdmin: true },
        { email: good.email },
      ]) {
        const response = await browser()
          .post('/api/auth/sign-up')
          .send(bad)
          .expect(400);
        expect(response.body.message).toEqual(expect.any(String));
      }
    });

    it('is refused once a server admin switches sign-up off', async () => {
      const { agent: admin } = await signedUpAs(app, 'ana');

      await admin
        .patch('/api/server/settings')
        .send({ signUpOpen: false })
        .expect(200, { signUpOpen: false });
      await browser().get('/api/server/settings').expect(200, {
        signUpOpen: false,
      });

      await browser()
        .post('/api/auth/sign-up')
        .send({
          email: 'ben@example.com',
          displayName: 'Ben',
          password: testPassword,
        })
        .expect(403);
    });

    it('lets only a server admin change server settings', async () => {
      await signedUpAs(app, 'ana');
      const { agent: ben } = await signedUpAs(app, 'ben');

      await ben
        .patch('/api/server/settings')
        .send({ signUpOpen: false })
        .expect(403);
    });
  });

  describe('sign-in and sign-out', () => {
    it('signs in with the right password, in any letter case of the email', async () => {
      await signedUpAs(app, 'ana');
      const agent = browser();

      await agent
        .post('/api/auth/sign-in')
        .send({ email: 'ANA@example.com', password: testPassword })
        .expect(200);

      await agent.get('/api/auth/me').expect(200);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      await signedUpAs(app, 'ana');

      const wrong = await browser()
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: 'not the password' })
        .expect(401);
      const unknown = await browser()
        .post('/api/auth/sign-in')
        .send({ email: 'nobody@example.com', password: testPassword })
        .expect(401);

      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('makes an email wait after 5 failed attempts, even with the right password', async () => {
      await signedUpAs(app, 'ana');
      for (let i = 0; i < 5; i++) {
        await browser()
          .post('/api/auth/sign-in')
          .send({ email: 'ana@example.com', password: 'not the password' })
          .expect(401);
      }

      const response = await browser()
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: testPassword })
        .expect(429);

      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('ends the session on sign-out', async () => {
      const { agent } = await signedUpAs(app, 'ana');

      await agent.post('/api/auth/sign-out').expect(204);

      await agent.get('/api/auth/me').expect(401);
      await expect(prisma.session.count()).resolves.toBe(0);
    });

    it('refuses requests without a session, or with an expired one', async () => {
      const { agent } = await signedUpAs(app, 'ana');
      await browser().get('/api/auth/me').expect(401);
      await browser()
        .get('/api/auth/me')
        .set('Cookie', 'tessera_session=made-up')
        .expect(401);

      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await agent.get('/api/auth/me').expect(401);
    });

    it('keeps a session alive while it is being used', async () => {
      const { agent } = await signedUpAs(app, 'ana');
      const soon = new Date(Date.now() + 60_000);
      await prisma.session.updateMany({
        data: { expiresAt: soon, lastUsedAt: new Date(Date.now() - 7_200_000) },
      });

      await agent.get('/api/auth/me').expect(200);

      const session = await prisma.session.findFirstOrThrow();
      expect(session.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 29 * 86_400_000,
      );
    });
  });

  describe('changing password', () => {
    it('ends every other session and keeps this browser signed in', async () => {
      const { agent: laptop } = await signedUpAs(app, 'ana');
      const phone = browser();
      await phone
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: testPassword })
        .expect(200);

      await laptop
        .post('/api/auth/password')
        .send({
          currentPassword: testPassword,
          newPassword: 'another long password',
        })
        .expect(204);

      await laptop.get('/api/auth/me').expect(200);
      await phone.get('/api/auth/me').expect(401);
      await browser()
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: 'another long password' })
        .expect(200);
    });

    it('refuses a wrong current password', async () => {
      const { agent } = await signedUpAs(app, 'ana');

      await agent
        .post('/api/auth/password')
        .send({
          currentPassword: 'not the password',
          newPassword: 'another long password',
        })
        .expect(403);
    });
  });
});
