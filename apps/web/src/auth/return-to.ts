// Where to go after signing in: the page the person was sent away from, as
// long as it is a page of this app. "//site" and "/\site" would lead to
// another website, so they are refused.
export function safeReturnTo(value: string | null): string {
  if (value && /^\/(?![/\\])/.test(value)) {
    return value
  }
  return '/projects'
}
