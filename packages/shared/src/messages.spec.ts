import { describe, expect, it } from 'vitest';
import {
  messageBodyRequestSchema,
  messageBodySchema,
  newMessageSchema,
  type Message,
} from './index.js';

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

// Criterion 37 (agreed 2026-11-10): lists and quotes count together.
const TOO_DEEP = 'Use at most 10 levels of lists and quotes';

// `levels` nested levels, each opened with one of `marks`, in turn.
function nested(levels: number, marks: string[]) {
  return (
    Array.from({ length: levels }, (_, i) => marks[i % marks.length]).join('') +
    'x'
  );
}

// Nested bullet lists, one per line, each two spaces further in.
function indentedList(levels: number) {
  return Array.from(
    { length: levels },
    (_, i) => `${'  '.repeat(i)}- level ${i + 1}`,
  ).join('\n');
}

describe('messageBodySchema: nesting (criterion 37)', () => {
  const kinds: [string, (levels: number) => string][] = [
    ['lists on one line', (n) => nested(n, ['- '])],
    ['indented lists', indentedList],
    ['quotes', (n) => nested(n, ['> '])],
    ['lists and quotes together', (n) => nested(n, ['> ', '- '])],
  ];

  // 37
  it.each(kinds)('accepts 10 levels of %s', (_name, build) => {
    expect(messageBodySchema.safeParse(build(10)).success).toBe(true);
  });

  // 37
  it.each(kinds)('refuses 11 levels of %s, saying why', (_name, build) => {
    const result = messageBodySchema.safeParse(build(11));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(TOO_DEEP);
  });

  // 37
  it('refuses a very deep body without crashing', () => {
    const result = messageBodySchema.safeParse('- '.repeat(500) + 'x');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(TOO_DEEP);
  });

  // 37
  it('applies to the request body of sending and editing too', () => {
    expect(
      messageBodyRequestSchema.safeParse({ body: nested(11, ['> ']) }).success,
    ).toBe(false);
    expect(
      newMessageSchema.safeParse({ body: nested(11, ['> ']) }).success,
    ).toBe(false);
  });
});

describe('newMessageSchema (criterion 39)', () => {
  // 39 (assumed name: the body of POST /api/chats/:chatId/messages)
  it('takes a body, with an optional id that is a UUID', () => {
    const id = '3f2b8c1e-9d4a-4f6b-8a1c-2e7d5b9a0c11';
    expect(newMessageSchema.safeParse({ body: 'Hi' }).success).toBe(true);
    const withId = newMessageSchema.safeParse({ body: 'Hi', id });
    expect(withId.success).toBe(true);
    expect(withId.data).toEqual({ body: 'Hi', id });
  });

  // 39
  it('refuses an id that is not a UUID, and still checks the body', () => {
    expect(newMessageSchema.safeParse({ body: 'Hi', id: 'abc' }).success).toBe(
      false,
    );
    expect(
      newMessageSchema.safeParse({ body: '  ', id: undefined }).success,
    ).toBe(false);
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
