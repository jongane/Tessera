import { z } from 'zod';

export const MAX_ENTRY_MINUTES = 24 * 60;
export const MAX_ESTIMATE_MINUTES = 10_000 * 60;

// What forms show when a time entry is out of bounds; the API says the same.
export const ENTRY_TOO_SHORT_MESSAGE = 'Log at least 1 minute';
export const ENTRY_TOO_LONG_MESSAGE = 'Log at most 24 hours at a time';
export const NOTE_TOO_LONG_MESSAGE = 'Use at most 1000 characters';

const minutesField = z
  .number()
  .int()
  .min(1, { message: ENTRY_TOO_SHORT_MESSAGE })
  .max(MAX_ENTRY_MINUTES, { message: ENTRY_TOO_LONG_MESSAGE });
// A day not yet started in the project's time zone is refused by the API.
const workDateField = z.iso.date();
const noteField = z
  .string()
  .trim()
  .max(1000, { message: NOTE_TOO_LONG_MESSAGE });

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
