import { z } from 'zod';

const titleField = z.string().trim().min(1).max(200);
// Generous, as descriptions will become rich text.
const descriptionField = z.string().max(50_000);

export const newCardSchema = z.strictObject({
  title: titleField,
  description: descriptionField.optional(),
});

export const cardChangesSchema = z.strictObject({
  title: titleField.optional(),
  // An empty description clears it.
  description: descriptionField.optional(),
});

export const completionSchema = z.strictObject({
  // Go ahead even though some direct subtasks are still open.
  confirmOpenSubtasks: z.boolean().optional(),
});

export const moveCardSchema = completionSchema.extend({
  columnId: z.uuid(),
});

const subtaskChoiceSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('delete') }),
  z.strictObject({ action: z.literal('standalone') }),
  z.strictObject({ action: z.literal('move'), parentId: z.uuid() }),
]);

// What happens to each direct subtask, by subtask id. Only needed when the
// card has subtasks.
export const deleteCardSchema = z
  .strictObject({
    subtasks: z.record(z.uuid(), subtaskChoiceSchema).optional(),
  })
  .optional();

export type NewCardBody = z.infer<typeof newCardSchema>;
export type CardChangesBody = z.infer<typeof cardChangesSchema>;
export type CompletionBody = z.infer<typeof completionSchema>;
export type MoveCardBody = z.infer<typeof moveCardSchema>;
export type DeleteCardBody = z.infer<typeof deleteCardSchema>;
