import { z } from 'zod';
import { emailField } from './auth.js';

const roleField = z.enum(['ADMIN', 'MEMBER']);

export const newMemberSchema = z.strictObject({
  email: emailField,
  role: roleField.default('MEMBER'),
});

export const memberChangesSchema = z.strictObject({
  role: roleField,
});

export type NewMember = z.infer<typeof newMemberSchema>;
export type MemberChanges = z.infer<typeof memberChangesSchema>;
