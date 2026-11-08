import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { NulGuard } from './common/nul-guard.js';

// Settings shared by main.ts and the end-to-end tests, so the tests run the
// API exactly as it is served.
export function configureApp(app: INestApplication): void {
  // Every endpoint starts with /api, e.g. /api/auth/sign-in.
  app.setGlobalPrefix('api');
  // Reads the session cookie into request.cookies.
  app.use(cookieParser());
  // Refuses a NUL character anywhere in a request, before the zod rules.
  app.useGlobalGuards(new NulGuard(app.get(Reflector)));
}
