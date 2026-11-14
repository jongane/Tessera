import { describe, expect, it } from 'vitest';
import {
  cardChangesSchema,
  cardSearchQuerySchema,
  CHOOSE_WHAT_HAPPENS_TO_FILES,
  completionSchema,
  deleteCardQuerySchema,
  deleteCardSchema,
  MAX_ESTIMATE_MINUTES,
  moveCardSchema,
  newCardSchema,
  newSubtaskSchema,
  ownerChangeSchema,
  parentChangeSchema,
} from './index.js';

const id = '3f2b8c1e-5d4a-4b6c-9e8f-1a2b3c4d5e6f';

describe('newCardSchema', () => {
  it('accepts an existing chat for the card to take as its own', () => {
    expect(newCardSchema.parse({ title: 'Login page', chatId: id })).toEqual({
      title: 'Login page',
      chatId: id,
    });
    expect(
      newCardSchema.safeParse({ title: 'Login page', chatId: 'nope' }).success,
    ).toBe(false);
  });

  it('accepts a title, trimming it', () => {
    expect(newCardSchema.parse({ title: ' Login page ' })).toEqual({
      title: 'Login page',
    });
  });

  it('refuses a title over 200 characters', () => {
    expect(newCardSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});

describe('cardChangesSchema', () => {
  it('accepts a due day, a due time with an offset, or null', () => {
    for (const due of [
      { date: '2026-11-02' },
      { at: '2026-11-02T17:00:00+01:00' },
      null,
    ]) {
      expect(cardChangesSchema.safeParse({ due }).success).toBe(true);
    }
  });

  it('refuses a due time without an offset', () => {
    expect(
      cardChangesSchema.safeParse({ due: { at: '2026-11-02T17:00:00' } })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown priority', () => {
    expect(cardChangesSchema.safeParse({ priority: 'SOON' }).success).toBe(
      false,
    );
  });

  it('accepts an estimate up to the maximum, or null to clear it', () => {
    expect(
      cardChangesSchema.safeParse({ estimateMinutes: MAX_ESTIMATE_MINUTES })
        .success,
    ).toBe(true);
    expect(
      cardChangesSchema.safeParse({ estimateMinutes: MAX_ESTIMATE_MINUTES + 1 })
        .success,
    ).toBe(false);
    expect(cardChangesSchema.safeParse({ estimateMinutes: null }).success).toBe(
      true,
    );
  });
});

describe('subtasks and parents', () => {
  it('needs a column for a new subtask', () => {
    expect(newSubtaskSchema.safeParse({ title: 'Form' }).success).toBe(false);
    expect(
      newSubtaskSchema.safeParse({ title: 'Form', columnId: id }).success,
    ).toBe(true);
  });

  it('refuses a chat for a new subtask', () => {
    expect(
      newSubtaskSchema.safeParse({ title: 'Form', columnId: id, chatId: id })
        .success,
    ).toBe(false);
  });

  it('accepts null as the parent, for a top-level card', () => {
    expect(parentChangeSchema.safeParse({ parentId: null }).success).toBe(true);
  });
});

describe('completing and moving', () => {
  it('accepts an empty completion', () => {
    expect(completionSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a position to move to, 0 being the top', () => {
    expect(
      moveCardSchema.safeParse({ columnId: id, position: 0 }).success,
    ).toBe(true);
  });

  it('refuses a negative or fractional position', () => {
    for (const position of [-1, 1.5]) {
      expect(moveCardSchema.safeParse({ columnId: id, position }).success).toBe(
        false,
      );
    }
  });

  it('needs a column to move to', () => {
    expect(
      moveCardSchema.safeParse({ confirmOpenSubtasks: true }).success,
    ).toBe(false);
  });
});

describe('deleteCardSchema', () => {
  it('accepts no body, and a choice per subtask', () => {
    expect(deleteCardSchema.safeParse(undefined).success).toBe(true);
    expect(
      deleteCardSchema.safeParse({
        subtasks: { [id]: { action: 'move', parentId: id } },
      }).success,
    ).toBe(true);
  });

  it('refuses a move without a new parent', () => {
    expect(
      deleteCardSchema.safeParse({ subtasks: { [id]: { action: 'move' } } })
        .success,
    ).toBe(false);
  });
});

describe('deleteCardQuerySchema', () => {
  it('accepts no query, files=delete, or moveFilesTo with a card id', () => {
    expect(deleteCardQuerySchema.safeParse({}).success).toBe(true);
    expect(deleteCardQuerySchema.safeParse({ files: 'delete' }).success).toBe(
      true,
    );
    expect(deleteCardQuerySchema.safeParse({ moveFilesTo: id }).success).toBe(
      true,
    );
  });

  it('refuses both files and moveFilesTo, saying so', () => {
    const result = deleteCardQuerySchema.safeParse({
      files: 'delete',
      moveFilesTo: id,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Choose either to delete the files or to move them, not both',
    );
  });

  it('refuses a files value other than delete, and a repeated one', () => {
    for (const files of ['keep', ['delete', 'delete']]) {
      const result = deleteCardQuerySchema.safeParse({ files });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['files']);
      expect(result.error?.issues[0]?.message).toBe(
        'Invalid input: expected "delete"',
      );
    }
  });

  it('refuses a moveFilesTo that is not a card id, and unknown fields', () => {
    expect(
      deleteCardQuerySchema.safeParse({ moveFilesTo: 'nope' }).success,
    ).toBe(false);
    expect(deleteCardQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
  });
});

describe('CHOOSE_WHAT_HAPPENS_TO_FILES', () => {
  it('is exported with the text the delete dialog and the API share', () => {
    expect(CHOOSE_WHAT_HAPPENS_TO_FILES).toBe(
      'Choose what happens to this card’s files',
    );
  });
});

describe('ownerChangeSchema', () => {
  it('needs a user id', () => {
    expect(ownerChangeSchema.safeParse({ userId: id }).success).toBe(true);
    expect(ownerChangeSchema.safeParse({}).success).toBe(false);
  });
});

describe('cardSearchQuerySchema', () => {
  it('accepts a search, trimming it, with an optional limit', () => {
    expect(cardSearchQuerySchema.parse({ q: ' login ' })).toEqual({
      q: 'login',
    });
    expect(cardSearchQuerySchema.parse({ q: 'WEB-12', limit: '5' })).toEqual({
      q: 'WEB-12',
      limit: 5,
    });
  });

  it('refuses an empty or over-long search', () => {
    expect(cardSearchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(
      cardSearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success,
    ).toBe(false);
    expect(cardSearchQuerySchema.safeParse({}).success).toBe(false);
  });

  it('refuses a limit outside 1 to 50', () => {
    expect(
      cardSearchQuerySchema.safeParse({ q: 'a', limit: '0' }).success,
    ).toBe(false);
    expect(
      cardSearchQuerySchema.safeParse({ q: 'a', limit: '51' }).success,
    ).toBe(false);
  });
});
