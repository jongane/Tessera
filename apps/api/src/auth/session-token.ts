import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes: far too many to guess.
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only this hash is saved, so someone who reads the database still cannot
// use a session.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
