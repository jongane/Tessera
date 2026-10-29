import { z } from 'zod';

// The API trims and checks lengths (names up to 100, items up to 500).
const nameField = z.string().max(200);
const textField = z.string().max(1000);
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
