import { hashToken, newSessionToken } from './session-token.js';

describe('session tokens', () => {
  it('makes long random tokens that are safe in a cookie', () => {
    const token = newSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });

  it('hashes the same token the same way, without revealing it', () => {
    const token = newSessionToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
