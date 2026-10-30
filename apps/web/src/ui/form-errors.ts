import type { z } from 'zod'

// Checks form values with a shared rule (@tessera/shared). Gives the cleaned
// values, or the first problem with each field, keyed by field name.
export function checkForm<T extends z.ZodType>(
  schema: T,
  values: unknown,
):
  | { ok: true; data: z.infer<T> }
  | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(values)
  if (result.success) {
    return { ok: true, data: result.data }
  }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '')
    errors[field] ??= friendlyMessage(issue)
  }
  return { ok: false, errors }
}

// The shared rules word their own messages for passwords, emails and time
// zones. Length limits get plain words here.
function friendlyMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return Number(issue.minimum) <= 1
      ? 'This can’t be empty'
      : issue.message
  }
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `Use at most ${issue.maximum} characters`
  }
  return issue.message
}
