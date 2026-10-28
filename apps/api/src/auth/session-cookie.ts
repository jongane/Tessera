import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'tessera_session';
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// HttpOnly: page scripts cannot read it, so a script injected into a page
// cannot steal the session. SameSite=Lax: other websites cannot make the
// browser send it with their forms. Secure (HTTPS only) in production.
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  };
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_LIFETIME_MS,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, cookieOptions());
}
