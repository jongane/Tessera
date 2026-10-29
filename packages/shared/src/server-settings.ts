import { z } from 'zod';

export const serverSettingsChangesSchema = z.strictObject({
  signUpOpen: z.boolean().optional(),
});

export type ServerSettingsChanges = z.infer<typeof serverSettingsChangesSchema>;
