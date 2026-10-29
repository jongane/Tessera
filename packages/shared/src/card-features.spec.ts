import { describe, expect, it } from 'vitest';
import {
  activityQuerySchema,
  checklistChangesSchema,
  checklistItemChangesSchema,
  LABEL_COLOURS,
  labelChangesSchema,
  MAX_ENTRY_MINUTES,
  newChecklistItemSchema,
  newChecklistSchema,
  newLabelSchema,
  newTimeEntrySchema,
  startTimerSchema,
  timeEntryChangesSchema,
} from './index.js';

describe('labels', () => {
  it('accepts each of the 10 colours', () => {
    expect(LABEL_COLOURS).toHaveLength(10);
    for (const colour of LABEL_COLOURS) {
      expect(
        newLabelSchema.safeParse({ name: 'Frontend', colour }).success,
      ).toBe(true);
    }
  });

  it('refuses another colour, and a name over 50 characters', () => {
    expect(
      newLabelSchema.safeParse({ name: 'Frontend', colour: 'BLACK' }).success,
    ).toBe(false);
    expect(labelChangesSchema.safeParse({ name: 'x'.repeat(51) }).success).toBe(
      false,
    );
  });
});

describe('checklists', () => {
  it('accepts a name, and a move to a position', () => {
    expect(newChecklistSchema.safeParse({ name: 'Testing' }).success).toBe(
      true,
    );
    expect(checklistChangesSchema.safeParse({ position: 0 }).success).toBe(
      true,
    );
  });

  it('refuses a negative position', () => {
    expect(checklistItemChangesSchema.safeParse({ position: -1 }).success).toBe(
      false,
    );
  });

  it('accepts an item and ticking it', () => {
    expect(newChecklistItemSchema.safeParse({ text: 'Safari' }).success).toBe(
      true,
    );
    expect(checklistItemChangesSchema.safeParse({ isDone: true }).success).toBe(
      true,
    );
  });
});

describe('time', () => {
  it('accepts 1 minute to 24 hours on a day', () => {
    for (const minutes of [1, MAX_ENTRY_MINUTES]) {
      expect(
        newTimeEntrySchema.safeParse({ minutes, workDate: '2026-10-29' })
          .success,
      ).toBe(true);
    }
  });

  it('refuses 0 minutes, more than 24 hours, and a date that is not a day', () => {
    expect(
      newTimeEntrySchema.safeParse({ minutes: 0, workDate: '2026-10-29' })
        .success,
    ).toBe(false);
    expect(
      newTimeEntrySchema.safeParse({
        minutes: MAX_ENTRY_MINUTES + 1,
        workDate: '2026-10-29',
      }).success,
    ).toBe(false);
    expect(
      newTimeEntrySchema.safeParse({ minutes: 30, workDate: 'yesterday' })
        .success,
    ).toBe(false);
  });

  it('accepts null to remove a note', () => {
    expect(timeEntryChangesSchema.safeParse({ note: null }).success).toBe(true);
  });

  it('accepts starting a timer with nothing else', () => {
    expect(startTimerSchema.safeParse({}).success).toBe(true);
  });
});

describe('activityQuerySchema', () => {
  it('reads the page size from the address', () => {
    expect(activityQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
  });

  it('refuses more than 100 lines per page', () => {
    expect(activityQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
