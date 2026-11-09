import { z } from 'zod';

// What a text field is refused with when it holds a NUL character (U+0000).
// The character is invisible and PostgreSQL cannot store it. Typographic
// apostrophe, like CHECKLIST_BLANK_MESSAGE.
export const NUL_MESSAGE =
  'This contains a hidden character that can’t be saved';

export function hasNul(value: string): boolean {
  return value.includes('\u0000');
}

// A string that refuses a NUL before any other check, so its message is the
// first one a form shows. Start every text field from this, not z.string().
export function textWithoutNul() {
  return z
    .string()
    .refine((value) => !hasNul(value), { message: NUL_MESSAGE, abort: true });
}
