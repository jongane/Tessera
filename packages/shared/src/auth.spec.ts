import { describe, expect, it } from 'vitest';
import { changePasswordSchema, signInSchema, signUpSchema } from './index.js';

describe('signUpSchema', () => {
  it('accepts a new account, tidying the email', () => {
    const result = signUpSchema.parse({
      email: '  Ana@Example.COM ',
      displayName: ' Ana ',
      password: 'long enough pass',
    });
    expect(result).toEqual({
      email: 'ana@example.com',
      displayName: 'Ana',
      password: 'long enough pass',
    });
  });

  it('refuses a password under 10 characters, saying why', () => {
    const result = signUpSchema.safeParse({
      email: 'ana@example.com',
      displayName: 'Ana',
      password: 'short',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'A password must be at least 10 characters',
    );
  });

  it('refuses an invalid email, saying why', () => {
    const result = signUpSchema.safeParse({
      email: 'not-an-email',
      displayName: 'Ana',
      password: 'long enough pass',
    });
    expect(result.error?.issues[0]?.message).toBe(
      'Enter a valid email address',
    );
  });

  it('refuses unknown fields', () => {
    const result = signUpSchema.safeParse({
      email: 'ana@example.com',
      displayName: 'Ana',
      password: 'long enough pass',
      isServerAdmin: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('signInSchema', () => {
  it('accepts a short password, which may predate the length rule', () => {
    expect(
      signInSchema.safeParse({ email: 'ana@example.com', password: 'old' })
        .success,
    ).toBe(true);
  });
});

describe('changePasswordSchema', () => {
  it('applies the length rule to the new password only', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'long enough pass',
      }).success,
    ).toBe(true);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'long enough pass',
        newPassword: 'short',
      }).success,
    ).toBe(false);
  });
});
