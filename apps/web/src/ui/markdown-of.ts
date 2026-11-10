import type { Editor } from '@tiptap/react'

// The editor's Markdown writer (Tiptap's) turns > < & into &gt; &lt; &amp; in
// every text. Typed text is kept as typed instead (the Markdown reader takes
// HTML as text, see ./markdown), so each text is escaped here, as it is
// written, with exactly what Markdown needs to read it back as typed:
// - the characters Tiptap already escapes (\ ` * _ [ ] ~);
// - "&" before something that reads as an entity (a typed "&lt;");
// - "<" that would open an autolink (a typed "<https://example.org>");
// - at the start of a line: "#", ">", "-", "+", "1." and "1)" (a heading, a
//   quote, a list), and a line of "-" or "=" (a divider or heading underline).
// Code (inline, and code blocks) is never touched: Markdown takes it literally.
type Node = { type?: string; text?: string; marks?: { type: string }[] }
type Parent = { type?: string; content?: Node[] }
type Writer = {
  codeTypes: Set<string>
  escapeMarkdownSyntax(text: string): string
  encodeTextForMarkdown(text: string, node: Node, parent?: Parent): string
}

const ENTITY = /&(?=#?\w+;)/g
const AUTOLINK = /<(?=[^\s<>]*[:@][^\s<>]*>)/g
const LINE_STARTS: [RegExp, string][] = [
  [/^( {0,3})(#{1,6})(?=[ \t]|$)/, '$1\\$2'],
  [/^( {0,3})>/, '$1\\>'],
  [/^( {0,3})([-+])(?=[ \t]|$)/, '$1\\$2'],
  [/^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)/, '$1$2\\$3'],
  [/^( {0,3})([-=])(?=[-=]*[ \t]*$)/, '$1\\$2'],
]

function escapeLineStart(line: string): string {
  for (const [pattern, replacement] of LINE_STARTS) {
    if (pattern.test(line)) return line.replace(pattern, replacement)
  }
  return line
}

function startsLine(node: Node, parent?: Parent): boolean {
  const index = parent?.content?.indexOf(node) ?? 0
  return index <= 0 || parent?.content?.[index - 1]?.type === 'hardBreak'
}

function isCode(writer: Writer, node: Node, parent?: Parent): boolean {
  return (
    (parent?.type !== undefined && writer.codeTypes.has(parent.type)) ||
    (node.marks ?? []).some((mark) => writer.codeTypes.has(mark.type))
  )
}

const written = new WeakSet<object>()

function typedTextWriter(editor: Editor): Writer {
  const writer = editor.markdown as unknown as Writer
  if (written.has(writer)) return writer
  written.add(writer)
  // This is the editor's own writer, not Tiptap's shared one.
  writer.encodeTextForMarkdown = (text, node, parent) => {
    if (isCode(writer, node, parent)) return text
    const lines = writer
      .escapeMarkdownSyntax(text)
      .replace(ENTITY, '&amp;')
      .replace(AUTOLINK, '\\<')
      .split('\n')
    const first = startsLine(node, parent)
    return lines
      .map((line, i) => (i > 0 || first ? escapeLineStart(line) : line))
      .join('\n')
  }
  return writer
}

export function markdownOf(editor: Editor): string {
  if (editor.isEmpty) return ''
  const writer = typedTextWriter(editor) as unknown as {
    serialize(json: unknown): string
  }
  return writer.serialize(editor.getJSON()).trim()
}
