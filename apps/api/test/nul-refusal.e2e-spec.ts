import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { boardScenario } from './support/board-scenario.js';
import { resetDatabase } from './support/reset-database.js';
import { signedUpAs, startTestApp, testPassword } from './support/test-app.js';

// A NUL character (U+0000) cannot be stored by PostgreSQL, so it used to give
// 500. Now the API refuses it with 400 and one message, wherever it arrives:
// body, query string or URL (plan "refuse NUL characters in text fields").
// The message uses the typographic apostrophe, as the shared rules do.
const NUL_MESSAGE = 'This contains a hidden character that can’t be saved';

describe('A NUL character in a request (e2e)', () => {
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

  function expectHiddenCharacterRefusal(response: request.Response) {
    expect(response.status).toBe(400);
    expect(String(response.body.message)).toContain(NUL_MESSAGE);
  }

  describe('in a saved text field of the body', () => {
    // Criterion 3
    it('refuses a card title with 400 and the message, and keeps the old title', async () => {
      const { ana, cardUrl } = await boardScenario(app);

      const response = await ana.agent
        .patch(cardUrl)
        .send({ title: 'Log\u0000in' });

      expectHiddenCharacterRefusal(response);
      const card = await ana.agent.get(cardUrl).expect(200);
      expect(card.body.title).toBe('Login');
    });

    // Criterion 3
    it('refuses a new board name and a new card description', async () => {
      const { ana, project, toDo } = await boardScenario(app);

      expectHiddenCharacterRefusal(
        await ana.agent
          .post(`/api/projects/${project.id}/boards`)
          .send({ name: 'Sprint\u0000 2' }),
      );
      expectHiddenCharacterRefusal(
        await ana.agent
          .post(`/api/columns/${toDo.id}/cards`)
          .send({ title: 'Fine', description: 'Has a\u0000 hidden one' }),
      );
    });

    // Criterion 3
    it('refuses a sign-up with a NUL in the display name, email or new password', async () => {
      const good = {
        email: 'ana@example.com',
        displayName: 'Ana',
        password: testPassword,
      };
      const agent = () => request.agent(app.getHttpServer());

      for (const bad of [
        { ...good, displayName: 'An\u0000a' },
        { ...good, email: 'an\u0000a@example.com' },
        { ...good, password: 'a long enough\u0000 password' },
      ]) {
        expectHiddenCharacterRefusal(
          await agent().post('/api/auth/sign-up').send(bad),
        );
      }
    });

    // Criteria 3 and 6
    it('refuses a NUL in the new password when changing it', async () => {
      const { agent } = await signedUpAs(app, 'ana');

      const response = await agent.post('/api/auth/password').send({
        currentPassword: testPassword,
        newPassword: 'another long\u0000 password',
      });

      expectHiddenCharacterRefusal(response);
    });
  });

  describe('somewhere the rules for the request do not name', () => {
    // Criterion 3 (safety net)
    it('refuses a NUL inside a JSON key with the same message', async () => {
      const { ana, cardUrl } = await boardScenario(app);

      const response = await ana.agent
        .patch(cardUrl)
        .send({ ['ti\u0000tle']: 'Login' });

      expectHiddenCharacterRefusal(response);
    });

    // Criterion 3 (safety net)
    it('refuses a NUL deep inside a nested value with the same message', async () => {
      const { ana, cardUrl } = await boardScenario(app);

      const response = await ana.agent
        .patch(cardUrl)
        .send({ due: { date: '2026-11-02\u0000' } });

      expectHiddenCharacterRefusal(response);
    });

    // Criterion 3 (safety net)
    it('refuses a NUL in a query value that is not text, such as the limit', async () => {
      const { ana, project } = await boardScenario(app);

      const response = await ana.agent.get(
        `/api/projects/${project.id}/cards?q=login&limit=5%00`,
      );

      expectHiddenCharacterRefusal(response);
    });
  });

  describe('in the query string', () => {
    // Criterion 3
    it('refuses a card search with a NUL in q, instead of 500', async () => {
      const { ana, project } = await boardScenario(app);

      const response = await ana.agent.get(
        `/api/projects/${project.id}/cards?q=log%00in`,
      );

      expectHiddenCharacterRefusal(response);
    });

    // Criterion 3
    it('refuses a NUL in the suggested-code name and in the activity page start', async () => {
      const { ana, cardUrl } = await boardScenario(app);

      expectHiddenCharacterRefusal(
        await ana.agent.get('/api/projects/suggest-code?name=Web%00site'),
      );
      expectHiddenCharacterRefusal(
        await ana.agent.get(`${cardUrl}/activity?before=12%00`),
      );
    });
  });

  describe('in the URL', () => {
    // Criterion 3
    it('refuses opening a project by a code with a NUL, instead of 500', async () => {
      const { ana } = await boardScenario(app);

      const response = await ana.agent.get('/api/projects/by-code/WE%00B');

      expectHiddenCharacterRefusal(response);
    });

    // Criterion 3
    it('refuses opening a card by a number with a NUL, instead of 500', async () => {
      const { ana } = await boardScenario(app);

      const response = await ana.agent.get('/api/cards/by-number/WEB-1%00');

      expectHiddenCharacterRefusal(response);
    });
  });

  describe('in an existing password', () => {
    // Criterion 6
    it('still gives the normal wrong-credentials answer when signing in', async () => {
      await signedUpAs(app, 'ana');
      const agent = request.agent(app.getHttpServer());
      const wrong = await agent
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: 'not the password' });

      const withNul = await agent
        .post('/api/auth/sign-in')
        .send({ email: 'ana@example.com', password: 'not the\u0000 password' });

      expect(withNul.status).toBe(401);
      expect(withNul.body.message).toBe(wrong.body.message);
    });

    // Criterion 6
    it('still refuses a wrong current password as before when changing it', async () => {
      const { agent } = await signedUpAs(app, 'ana');

      await agent
        .post('/api/auth/password')
        .send({
          currentPassword: 'not the\u0000 password',
          newPassword: 'another long password',
        })
        .expect(403);
    });
  });

  describe('text without a NUL', () => {
    // Criteria 2 and 7
    it('is saved as before, with tab, new line, carriage return and emoji', async () => {
      const { ana, cardUrl } = await boardScenario(app);

      const response = await ana.agent
        .patch(cardUrl)
        .send({ title: 'Plan\tthe day 😀', description: 'one\r\ntwo\nthree' })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Plan\tthe day 😀',
        description: 'one\r\ntwo\nthree',
      });
    });
  });
});
