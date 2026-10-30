import { describe, expect, it } from 'vitest';
import {
  cardChangesSchema,
  completionSchema,
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

describe('ownerChangeSchema', () => {
  it('needs a user id', () => {
    expect(ownerChangeSchema.safeParse({ userId: id }).success).toBe(true);
    expect(ownerChangeSchema.safeParse({}).success).toBe(false);
  });
});
