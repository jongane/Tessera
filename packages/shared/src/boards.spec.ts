import { describe, expect, it } from 'vitest';
import {
  columnChangesSchema,
  newBoardSchema,
  newThreadSchema,
  threadLinkSchema,
} from './index.js';

const id = '3f2b8c1e-5d4a-4b6c-9e8f-1a2b3c4d5e6f';

describe('newBoardSchema', () => {
  it('accepts a name of up to 100 characters', () => {
    expect(newBoardSchema.safeParse({ name: 'x'.repeat(100) }).success).toBe(
      true,
    );
    expect(newBoardSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(
      false,
    );
  });
});

describe('columnChangesSchema', () => {
  it('needs isDone', () => {
    expect(columnChangesSchema.safeParse({}).success).toBe(false);
  });
});

describe('newThreadSchema', () => {
  it('trims the title and refuses an empty one', () => {
    expect(newThreadSchema.parse({ title: ' Release plan ' })).toEqual({
      title: 'Release plan',
    });
    expect(newThreadSchema.safeParse({ title: ' ' }).success).toBe(false);
  });
});

describe('threadLinkSchema', () => {
  it('needs a card id', () => {
    expect(threadLinkSchema.safeParse({ cardId: id }).success).toBe(true);
    expect(threadLinkSchema.safeParse({ cardId: 'WEB-12' }).success).toBe(
      false,
    );
  });
});
