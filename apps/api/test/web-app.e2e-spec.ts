import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/configure-app.js';

// In production the API also serves the built web app, so both share one
// address (docs/adr/0001). A stand-in for apps/web/dist is used here.
describe('Serving the web app (e2e)', () => {
  let app: INestApplication<App>;
  let webAppDir: string;

  beforeAll(async () => {
    webAppDir = mkdtempSync(join(tmpdir(), 'tessera-web-'));
    writeFileSync(join(webAppDir, 'index.html'), '<title>Tessera</title>');
    mkdirSync(join(webAppDir, 'assets'));
    writeFileSync(join(webAppDir, 'assets', 'app.js'), 'console.log(1)');
    process.env.WEB_APP_DIR = webAppDir;
    // Imported only now, so the app sees WEB_APP_DIR.
    // Started as main.ts does: the testing module would create the static
    // file server before the HTTP server exists, so it would serve nothing.
    const { AppModule } = await import('../src/app.module.js');
    app = await NestFactory.create<INestApplication<App>>(AppModule, {
      logger: false,
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.WEB_APP_DIR;
    rmSync(webAppDir, { recursive: true, force: true });
  });

  it('serves the web app at the home address', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);
    expect(response.text).toContain('<title>Tessera</title>');
  });

  it('serves the web app for its own addresses, such as a board', async () => {
    const response = await request(app.getHttpServer())
      .get('/WEB/boards/123')
      .expect(200);
    expect(response.text).toContain('<title>Tessera</title>');
  });

  it('serves the web app’s files', async () => {
    const response = await request(app.getHttpServer())
      .get('/assets/app.js')
      .expect(200);
    expect(response.text).toBe('console.log(1)');
  });

  it('keeps /api for the API, including its 404s', async () => {
    await request(app.getHttpServer()).get('/api').expect(200, 'Hello World!');
    const missing = await request(app.getHttpServer())
      .get('/api/no-such-thing')
      .expect(404);
    expect(missing.text).not.toContain('<title>Tessera</title>');
  });
});
