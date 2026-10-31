import { z } from 'zod';
import { MAX_ESTIMATE_MINUTES } from './time.js';

const titleField = z.string().trim().min(1).max(200);
// Generous, as descriptions will become rich text.
const descriptionField = z.string().max(50_000);

export const newCardSchema = z.strictObject({
  title: titleField,
  description: descriptionField.optional(),
  // A chat with no card, on the same board, for the card to take as its
  // own ("Create a card for this chat?"). Without it the card gets a new one.
  chatId: z.uuid().optional(),
});

// A day ({ date: "2026-11-02" }), a day and time with its offset
// ({ at: "2026-11-02T17:00:00+01:00" }), or null for no due date.
const dueField = z.union([
  z.strictObject({ date: z.iso.date() }),
  z.strictObject({ at: z.iso.datetime({ offset: true }) }),
  z.null(),
]);

export const cardChangesSchema = z.strictObject({
  title: titleField.optional(),
  // An empty description clears it.
  description: descriptionField.optional(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  due: dueField.optional(),
  // Null clears it.
  estimateMinutes: z
    .number()
    .int()
    .min(0)
    .max(MAX_ESTIMATE_MINUTES)
    .nullable()
    .optional(),
});

export const newSubtaskSchema = newCardSchema.omit({ chatId: true }).extend({
  // Any column on any board of the parent's project.
  columnId: z.uuid(),
});

export const parentChangeSchema = z.strictObject({
  // Null makes it a top-level card.
  parentId: z.uuid().nullable(),
});

export const completionSchema = z.strictObject({
  // Go ahead even though some direct subtasks are still open.
  confirmOpenSubtasks: z.boolean().optional(),
});

export const moveCardSchema = completionSchema.extend({
  columnId: z.uuid(),
  // Where in the column: 0 is the top, past the end is the bottom. Left
  // out, the card goes to the bottom.
  position: z.number().int().min(0).optional(),
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

// Makes an assignee the card's owner.
export const ownerChangeSchema = z.strictObject({ userId: z.uuid() });

export type NewCardBody = z.infer<typeof newCardSchema>;
export type CardChangesBody = z.infer<typeof cardChangesSchema>;
export type NewSubtaskBody = z.infer<typeof newSubtaskSchema>;
export type ParentChange = z.infer<typeof parentChangeSchema>;
export type CompletionBody = z.infer<typeof completionSchema>;
export type MoveCardBody = z.infer<typeof moveCardSchema>;
export type DeleteCardBody = z.infer<typeof deleteCardSchema>;
export type OwnerChange = z.infer<typeof ownerChangeSchema>;
