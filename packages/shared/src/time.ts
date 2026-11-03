import { z } from 'zod';

export const MAX_ENTRY_MINUTES = 24 * 60;
export const MAX_ESTIMATE_MINUTES = 10_000 * 60;

const minutesField = z.number().int().min(1).max(MAX_ENTRY_MINUTES);
// A day not yet started in the project's time zone is refused by the API.
const workDateField = z.iso.date();
const noteField = z.string().trim().max(1000);

export const newTimeEntrySchema = z.strictObject({
  minutes: minutesField,
  workDate: workDateField,
  note: noteField.optional(),
});

export const timeEntryChangesSchema = z.strictObject({
  minutes: minutesField.optional(),
  workDate: workDateField.optional(),
  // Null removes the note.
  note: noteField.nullable().optional(),
});

// The timer is dated by the project's time zone, so no zone is sent.
export const startTimerSchema = z.strictObject({
  // Go ahead even though a timer is running on another card.
  stopRunning: z.boolean().optional(),
});

export type NewTimeEntryBody = z.infer<typeof newTimeEntrySchema>;
export type TimeEntryChangesBody = z.infer<typeof timeEntryChangesSchema>;
export type StartTimerBody = z.infer<typeof startTimerSchema>;
