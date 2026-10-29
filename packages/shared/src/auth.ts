import { z } from 'zod';

const MIN_PASSWORD_LENGTH = 10;
// Long enough for any passphrase, short enough that hashing stays quick.
const MAX_PASSWORD_LENGTH = 200;

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

const passwordField = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `A password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  )
  .max(MAX_PASSWORD_LENGTH);

export const signUpSchema = z.strictObject({
  email: emailField,
  displayName: z.string().trim().min(1).max(100),
  password: passwordField,
});

export const signInSchema = z.strictObject({
  email: emailField,
  // Not checked for length: an old password may predate today's rules.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordField,
});

export type SignUp = z.infer<typeof signUpSchema>;
export type SignIn = z.infer<typeof signInSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
