// Text that looks like HTML or an HTML entity, for the tests that check it is
// kept exactly as typed (criterion 43). The first column names the case.
export const TYPED_TEXTS: [string, string][] = [
  ['a less-than and a greater-than', 'a<b and c>d'],
  ['an HTML tag', 'use <div> here'],
  ['bold tags', 'x <b>bold</b> y'],
  ['a script tag', '<script>alert(1)</script> hi'],
  ['a literal entity', 'a literal &lt;div&gt; here'],
]

// Text typed into a card description is Markdown, so a ">" at the start of
// a line is a quote there; only the message box takes it as typed.
export const TYPED_LINE_START: [string, string] = [
  'a greater-than at the start of a line',
  '> not a quote',
]

// What was saved, with the backslashes Markdown may add for the text to read
// back the same taken away. Everything else must be as typed.
export function withoutEscapes(saved: string): string {
  return saved.replace(/\\(?=[<>&])/g, '')
}
