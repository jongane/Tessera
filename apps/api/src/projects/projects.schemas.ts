import { z } from 'zod';

// The project's own code rules (2 to 6 letters) are checked by
// ProjectsService, which gives a clearer message.
const codeField = z.string().max(20);

export const newProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  code: codeField,
});

export const projectChangesSchema = z.strictObject({
  code: codeField.optional(),
  timeZone: z.string().refine(isKnownTimeZone, 'Unknown time zone').optional(),
});

export const suggestCodeQuerySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});

export type NewProjectBody = z.infer<typeof newProjectSchema>;
export type ProjectChanges = z.infer<typeof projectChangesSchema>;
export type SuggestCodeQuery = z.infer<typeof suggestCodeQuerySchema>;

// An IANA time zone name such as "Europe/London".
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
