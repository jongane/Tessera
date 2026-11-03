import { describe, expect, it } from 'vitest';
import {
  checklistChangesSchema,
  checklistItemChangesSchema,
  MAX_CHECKLIST_ITEM,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_NAME,
  newChecklistItemSchema,
  newChecklistSchema,
} from './index.js';

// Web PR 7a, plan "Changes": the checklist limits are shared constants, so
// the API and the web app's forms give the same answer
// (docs/card-features.md, section 2).
describe('checklist limits', () => {
  it('are a name of 100, an item of 500 and 100 items per checklist', () => {
    expect(MAX_CHECKLIST_NAME).toBe(100);
    expect(MAX_CHECKLIST_ITEM).toBe(500);
    expect(MAX_CHECKLIST_ITEMS).toBe(100);
  });

  it('accept a name of up to 100 characters, and refuse a longer one', () => {
    const longest = 'x'.repeat(MAX_CHECKLIST_NAME);
    const tooLong = 'x'.repeat(MAX_CHECKLIST_NAME + 1);
    expect(newChecklistSchema.safeParse({ name: longest }).success).toBe(true);
    expect(newChecklistSchema.safeParse({ name: tooLong }).success).toBe(false);
    expect(checklistChangesSchema.safeParse({ name: longest }).success).toBe(
      true,
    );
    expect(checklistChangesSchema.safeParse({ name: tooLong }).success).toBe(
      false,
    );
  });

  it('accept an item of up to 500 characters, and refuse a longer one', () => {
    const longest = 'x'.repeat(MAX_CHECKLIST_ITEM);
    const tooLong = 'x'.repeat(MAX_CHECKLIST_ITEM + 1);
    expect(newChecklistItemSchema.safeParse({ text: longest }).success).toBe(
      true,
    );
    expect(newChecklistItemSchema.safeParse({ text: tooLong }).success).toBe(
      false,
    );
    expect(
      checklistItemChangesSchema.safeParse({ text: longest }).success,
    ).toBe(true);
    expect(
      checklistItemChangesSchema.safeParse({ text: tooLong }).success,
    ).toBe(false);
  });

  // The API trims before it counts, so spaces around the text don't count
  // here either.
  it('count the length without the spaces around it', () => {
    const name = ` ${'x'.repeat(MAX_CHECKLIST_NAME)} `;
    const text = ` ${'x'.repeat(MAX_CHECKLIST_ITEM)} `;
    expect(newChecklistSchema.safeParse({ name }).success).toBe(true);
    expect(newChecklistItemSchema.safeParse({ text }).success).toBe(true);
  });
});
