import { describe, expect, it } from 'vitest';
import {
  memberChangesSchema,
  newMemberSchema,
  newProjectSchema,
  projectChangesSchema,
  serverSettingsChangesSchema,
  suggestCodeQuerySchema,
} from './index.js';

describe('newProjectSchema', () => {
  it('accepts a name and code, trimming the name', () => {
    expect(newProjectSchema.parse({ name: ' Website ', code: 'WEB' })).toEqual({
      name: 'Website',
      code: 'WEB',
    });
  });

  it('refuses an empty name', () => {
    expect(
      newProjectSchema.safeParse({ name: '  ', code: 'WEB' }).success,
    ).toBe(false);
  });
});

describe('projectChangesSchema', () => {
  it('accepts a known time zone', () => {
    expect(
      projectChangesSchema.safeParse({ timeZone: 'Europe/London' }).success,
    ).toBe(true);
  });

  it('accepts the relationship colours, one of the label colours or dark', () => {
    expect(
      projectChangesSchema.parse({
        relationColours: { selected: 'DARK', parent: 'TEAL' },
      }),
    ).toEqual({ relationColours: { selected: 'DARK', parent: 'TEAL' } });
    expect(
      projectChangesSchema.safeParse({ relationColours: { parent: 'BEIGE' } })
        .success,
    ).toBe(false);
    expect(
      projectChangesSchema.safeParse({ relationColours: { cousin: 'RED' } })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown time zone, saying why', () => {
    const result = projectChangesSchema.safeParse({ timeZone: 'Mars/Base' });
    expect(result.error?.issues[0]?.message).toBe('Unknown time zone');
  });
});

describe('suggestCodeQuerySchema', () => {
  it('needs a name', () => {
    expect(suggestCodeQuerySchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('newMemberSchema', () => {
  it('makes a new member an ordinary member by default', () => {
    expect(newMemberSchema.parse({ email: 'Ben@Example.com' })).toEqual({
      email: 'ben@example.com',
      role: 'MEMBER',
    });
  });

  it('refuses an unknown role', () => {
    expect(memberChangesSchema.safeParse({ role: 'OWNER' }).success).toBe(
      false,
    );
  });
});

describe('serverSettingsChangesSchema', () => {
  it('accepts switching sign-up off', () => {
    expect(serverSettingsChangesSchema.parse({ signUpOpen: false })).toEqual({
      signUpOpen: false,
    });
  });
});
