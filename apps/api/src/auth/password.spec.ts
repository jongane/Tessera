import { hashPassword, verifyPassword } from './password.js';

describe('passwords', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse');

    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct house', stored)).resolves.toBe(false);
  });

  it('never stores the password itself, and salts each hash', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');

    expect(first).not.toContain('correct horse');
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
  });

  it('refuses anything that is not a hash it made', async () => {
    await expect(verifyPassword('x', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$1$2$3$$')).resolves.toBe(false);
  });
});
