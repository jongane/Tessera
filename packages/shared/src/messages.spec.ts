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

// Criterion 44 (agreed 2026-11-10): the nesting limit counts the way the
// message is read. Antagonist proofs, round 2, kept as regression tests.
describe('messageBodySchema: nesting counted as read (criterion 44)', () => {
  const tooDeep = (body: string) => {
    const result = messageBodySchema.safeParse(body);
    return result.success ? 'accepted' : result.error.issues[0]?.message;
  };

  // 44. CommonMark: ">>>x" is three quotes; no space is needed after ">".
  it('refuses 11 quotes written without spaces', () => {
    expect(tooDeep('>'.repeat(11) + 'x')).toBe(TOO_DEEP);
  });

  // 44. One quote holding a list nested 11 levels by indenting.
  it('refuses a list nested by indenting inside a quote', () => {
    const body = Array.from(
      { length: 11 },
      (_, i) => `> ${'  '.repeat(i)}- level ${i + 1}`,
    ).join('\n');
    expect(tooDeep(body)).toBe(TOO_DEEP);
  });

  // 44. Text in a code block is not a list or a quote.
  it('accepts quote marks inside a code block', () => {
    expect(tooDeep('```\n' + '> '.repeat(11) + 'x\n```')).toBe('accepted');
  });

  // 44. "- - - ..." on its own line is a horizontal rule, not nested lists.
  it('accepts a horizontal rule written with spaced dashes', () => {
    expect(tooDeep('Above\n\n- - - - - - - - - - - -\n\nBelow')).toBe(
      'accepted',
    );
  });
});

describe('messageBodySchema: more nesting cases (criterion 44)', () => {
  const tooDeep = (body: string) => {
    const result = messageBodySchema.safeParse(body);
    return result.success ? 'accepted' : result.error.issues[0]?.message;
  };

  // 44
  it('counts quotes written with and without spaces the same way', () => {
    expect(tooDeep('>'.repeat(10) + 'x')).toBe('accepted');
    expect(tooDeep('> > > > > > > > > > > x')).toBe(TOO_DEEP);
    expect(tooDeep('>> > >> > >>>>> x')).toBe(TOO_DEEP);
  });

  // 44
  it('accepts quote marks inside an indented code block', () => {
    expect(tooDeep('Intro\n\n    ' + '> '.repeat(11) + 'x')).toBe('accepted');
  });

  // 44
  it('accepts a divider written with asterisks, and underscores', () => {
    expect(tooDeep('Above\n\n***\n\nBelow')).toBe('accepted');
    expect(tooDeep('Above\n\n* * * * * * * * * * * *\n\nBelow')).toBe(
      'accepted',
    );
    expect(tooDeep('Above\n\n_ _ _ _ _ _ _ _ _ _ _ _\n\nBelow')).toBe(
      'accepted',
    );
  });

  // 44
  it('accepts quote marks inside a tilde-fenced code block', () => {
    expect(tooDeep('~~~\n' + '> '.repeat(11) + 'x\n~~~')).toBe('accepted');
  });

  // 44: linear time and no recursion, so a hostile body is decided quickly
  // and never throws (even one far over the length limit).
  it.each([
    ['quotes', '>'.repeat(100_000) + 'x'],
    ['spaced quotes', '> '.repeat(50_000) + 'x'],
    ['lists', '- '.repeat(50_000) + 'x'],
    ['blank lines', 'a' + '\n'.repeat(100_000) + 'b'],
    [
      'indentation',
      Array.from({ length: 2_000 }, (_, i) => ' '.repeat(i % 60) + '- x').join(
        '\n',
      ),
    ],
    ['backticks', '`'.repeat(100_000)],
  ])(
    'decides a 100,000-character body of %s quickly, without throwing',
    (_name, body) => {
      const started = performance.now();

      expect(() => messageBodySchema.safeParse(body)).not.toThrow();

      expect(performance.now() - started).toBeLessThan(500);
    },
  );

  // 44: still decided within the length limit
  it('refuses 5,000 spaced quotes with the nesting message, quickly', () => {
    const started = performance.now();

    expect(tooDeep('> '.repeat(4_999) + 'x')).toBe(TOO_DEEP);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

// Criterion 44, fence rules. Antagonist proofs, round 3 (R4, R5).
describe('messageBodySchema: code fences (criterion 44)', () => {
  const verdict = (body: string) => {
    const result = messageBodySchema.safeParse(body);
    return result.success ? 'accepted' : result.error.issues[0]?.message;
  };

  // 44 (R4). "```a```" is inline code, not a fence (a backtick fence's info text
  // cannot hold a backtick), so the quotes after it are read as quotes.
  it('refuses 11 quotes after a line of inline code written with three backticks', () => {
    expect(verdict('```a```\n' + '> '.repeat(11) + 'x')).toBe(TOO_DEEP);
  });

  // 44 (R5). Nothing inside a code block counts, also when the block is in a
  // quote.
  it('accepts list marks inside a code block in a quote', () => {
    expect(verdict('> ```\n> ' + '- '.repeat(11) + 'x\n> ```')).toBe(
      'accepted',
    );
  });

  // 44 (R5). ... or in a nested list item.
  it('accepts quote marks inside a code block in a nested list', () => {
    expect(
      verdict(
        '- Steps\n  - Run this:\n    ```\n    ' +
          '> '.repeat(11) +
          'x\n    ```',
      ),
    ).toBe('accepted');
  });
});
