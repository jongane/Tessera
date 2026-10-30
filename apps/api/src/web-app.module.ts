import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';

// In production the API also serves the built web app (apps/web/dist), so
// the web app and the API share one address and the sign-in cookie just
// works (docs/adr/0001). Every address outside /api gets the web app, which
// then shows the right page. WEB_APP_DIR can point somewhere else.
export function webAppModules(): DynamicModule[] {
  const dir =
    process.env.WEB_APP_DIR ?? resolve(import.meta.dirname, '../../web/dist');
  // Not built (during development the web app has its own dev server).
  if (!existsSync(join(dir, 'index.html'))) {
    return [];
  }
  return [
    ServeStaticModule.forRoot({
      rootPath: dir,
      exclude: ['/api{/*path}'],
    }),
  ];
}
