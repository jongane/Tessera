import { z } from 'zod';

// The limits on checklists (docs/card-features.md, section 2). The API and
// the web app's forms both use them, so they give the same answer.
export const MAX_CHECKLIST_NAME = 100;
export const MAX_CHECKLIST_ITEM = 500;
export const MAX_CHECKLIST_ITEMS = 100;

// What an empty or spaces-only checklist name or item is refused with
// (agreed 2026-11-04). Same wording as the web app's other forms.
export const CHECKLIST_BLANK_MESSAGE = 'This can’t be empty';

// Said when a checklist is full: by the web app beside "Add item" and by
// the API when it refuses a 101st item.
export const CHECKLIST_FULL_MESSAGE = `A checklist holds up to ${MAX_CHECKLIST_ITEMS} items`;

// Trimmed first, so spaces around the text don't count. A custom check
// rather than `.min(1)`, so forms show this message as it is.
function trimmedText(max: number) {
  return z
    .string()
    .trim()
    .refine((value) => value.length > 0, { message: CHECKLIST_BLANK_MESSAGE })
    .max(max, { message: `Use at most ${max} characters` });
}

const nameField = trimmedText(MAX_CHECKLIST_NAME);
const textField = trimmedText(MAX_CHECKLIST_ITEM);
// Where to move it: 0 is first. Past the end puts it last.
const positionField = z.number().int().min(0);

export const newChecklistSchema = z.strictObject({ name: nameField });

export const checklistChangesSchema = z.strictObject({
  name: nameField.optional(),
  position: positionField.optional(),
});

export const newChecklistItemSchema = z.strictObject({ text: textField });

export const checklistItemChangesSchema = z.strictObject({
  text: textField.optional(),
  isDone: z.boolean().optional(),
  position: positionField.optional(),
});

export type NewChecklistBody = z.infer<typeof newChecklistSchema>;
export type ChecklistChangesBody = z.infer<typeof checklistChangesSchema>;
export type NewChecklistItemBody = z.infer<typeof newChecklistItemSchema>;
export type ChecklistItemChangesBody = z.infer<
  typeof checklistItemChangesSchema
>;
