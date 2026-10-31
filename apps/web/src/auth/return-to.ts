// Where to go after signing in: the page the person was sent away from, as
// long as it is a page of this app. "//site" and "/\site" would lead to
// another website, so they are refused. With nowhere to return to, the home
// page opens the last board used.
export function safeReturnTo(value: string | null): string {
  if (value && /^\/(?![/\\])/.test(value)) {
    return value
  }
  return '/'
}
