import { describe, expect, it } from 'vitest';
import { messageBodySchema, type Message } from './index.js';

// Chat messages PR, plan "Shared rules". messageBodySchema checks the text of
// a message, both when it is sent and when it is edited.
const NUL_MESSAGE = 'This contains a hidden character that can’t be saved';

describe('messageBodySchema', () => {
  // Criterion 1
  it('trims the text', () => {
    expect(messageBodySchema.parse('  Hello team \n')).toBe('Hello team');
  });

  // Criterion 1
  it('refuses blank text', () => {
    for (const blank of ['', ' ', '   ', '\n', ' \n\t ']) {
      expect(messageBodySchema.safeParse(blank).success, `“${blank}”`).toBe(
        false,
      );
    }
  });

  // Criterion 1
  it('accepts exactly 10,000 characters and refuses 10,001 with "Use at most 10000 characters"', () => {
    expect(messageBodySchema.safeParse('x'.repeat(10_000)).success).toBe(true);

    const result = messageBodySchema.safeParse('x'.repeat(10_001));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Use at most 10000 characters',
    );
  });

  // Criterion 1
  it('refuses a NUL character with the shared NUL message', () => {
    const result = messageBodySchema.safeParse('Hel\u0000lo');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(NUL_MESSAGE);
  });

  // Criterion 1
  it('keeps new lines and emoji inside the text', () => {
    expect(messageBodySchema.parse('Line one\n\nLine two 🎉👍🏽')).toBe(
      'Line one\n\nLine two 🎉👍🏽',
    );
  });
});

describe('Message', () => {
  // Criterion 2 (type only: checked by the type-aware linter and the build of
  // the apps, not at run time)
  it('has the fields of a chat message, with null for what has not happened', () => {
    const sent: Message = {
      id: 'm1',
      chatId: 'c1',
      body: 'Hello',
      createdAt: '2026-11-09T22:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      author: { id: 'u1', displayName: 'Ana' },
      deletedBy: null,
    };
    const deletedOfAGoneAccount: Message = {
      ...sent,
      editedAt: '2026-11-09T22:05:00.000Z',
      deletedAt: '2026-11-09T22:10:00.000Z',
      author: null,
      deletedBy: null,
    };
    expect(sent.author?.displayName).toBe('Ana');
    expect(deletedOfAGoneAccount.author).toBeNull();
  });
});
