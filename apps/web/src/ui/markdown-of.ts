import type { Editor } from '@tiptap/react'

// The editor's Markdown writer (Tiptap's) turns > < & into &gt; &lt; &amp; in
// every text. Typed text is kept as typed instead (the Markdown reader takes
// HTML as text, see ./markdown), so each text is escaped here, as it is
// written, with exactly what Markdown needs to read it back as typed:
// - the characters Tiptap already escapes (\ ` * _ [ ] ~);
// - "&" before something that reads as an entity (a typed "&lt;");
// - an address between < and > (a typed "<https://example.org>"), which would
//   be read as a link without the brackets, and addresses left as typed;
// - four spaces at the start of a line (code), and a line that looks like the dashes of
//   a table;
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
// What reads as a link by itself: an address between < and >, a web address
// and an email address. Their text is not escaped (a "\_" would be part of the
// link), and the ">" after an address in < > is written as an entity, or the
// link would take the ">" along.
const ADDRESS =
  /(?:https?:\/\/|www\.)[^\s<>`*~[\]\\]+|(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

type Address = { start: number; end: number; inner?: string }

// The addresses of a text, in order: those between < and > (found by a scan,
// each "<" reading on only up to the next "<", a space or a ">"), and web and
// email addresses outside them. No pattern here can take time in proportion
// to the square of the text.
function addressesIn(text: string): Address[] {
  const angled: Address[] = []
  let at = text.indexOf('<')
  while (at >= 0) {
    let end = at + 1
    while (end < text.length && !/[\s<>`]/.test(text[end]!)) end += 1
    const inner = text.slice(at + 1, end)
    if (text[end] === '>' && /[:@]/.test(inner)) {
      angled.push({ start: at, end: end + 1, inner })
    }
    at = text.indexOf('<', end > at ? end : at + 1)
  }
  const found: Address[] = []
  let next = 0
  for (const match of text.matchAll(ADDRESS)) {
    const start = match.index
    while (next < angled.length && angled[next]!.end <= start) {
      found.push(angled[next]!)
      next += 1
    }
    if (next < angled.length && angled[next]!.start <= start) continue
    found.push({ start, end: start + match[0].length })
  }
  return found.concat(angled.slice(next))
}

// A table's header line: dashes, with colons, between pipes.
function isTableDashes(line: string): boolean {
  const cells = line.split('|')
  if (cells[0]!.trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === '') cells.pop()
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
}

const LINE_STARTS: [RegExp, string][] = [
  [/^( {0,3})(#{1,6})(?=[ \t]|$)/, '$1\\$2'],
  [/^( {0,3})>/, '$1\\>'],
  [/^( {0,3})([-+])(?=[ \t]|$)/, '$1\\$2'],
  [/^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)/, '$1$2\\$3'],
  [/^( {0,3})([-=])(?=[-=]*[ \t]*$)/, '$1\\$2'],
]

function escapeLineStart(line: string): string {
  // Four spaces or more at the start of a line make code: the first one is
  // written as a character.
  if (line.startsWith('    ')) {
    return `&#32;${line.slice(1)}`
  }
  // A line of dashes between pipes is a table's header line.
  if (line.includes('|') && isTableDashes(line)) {
    return line.replace('|', '\\|')
  }
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

function escapeInline(writer: Writer, text: string): string {
  const plain = (part: string) =>
    writer.escapeMarkdownSyntax(part).replace(ENTITY, '&amp;')
  let result = ''
  let from = 0
  for (const found of addressesIn(text)) {
    result += plain(text.slice(from, found.start))
    result +=
      found.inner === undefined
        ? text.slice(found.start, found.end).replace(ENTITY, '&amp;')
        : `\\<${found.inner.replace(ENTITY, '&amp;')}&gt;`
    from = found.end
  }
  return result + plain(text.slice(from))
}

const written = new WeakSet<object>()

function typedTextWriter(editor: Editor): Writer {
  const writer = editor.markdown as unknown as Writer
  if (written.has(writer)) return writer
  written.add(writer)
  // This is the editor's own writer, not Tiptap's shared one.
  writer.encodeTextForMarkdown = (text, node, parent) => {
    if (isCode(writer, node, parent)) return text
    const lines = escapeInline(writer, text).split('\n')
    const first = startsLine(node, parent)
    return lines
      .map((line, i) => (i > 0 || first ? escapeLineStart(line) : line))
      .join('\n')
  }
  return writer
}

// A link address with a space, a bracket or a backslash would end the link
// early where it is written, between ( and ): it is written between < and >
// instead, as Markdown allows, with < > and \\ escaped.
function writableAddress(href: string): string {
  return /[\s()<>\\]/.test(href) ? `<${href.replace(/[<>\\]/g, '\\$&')}>` : href
}

type Json = {
  marks?: { type: string; attrs?: { href?: unknown } }[]
  content?: Json[]
}

function withWritableLinks(node: Json): Json {
  return {
    ...node,
    marks: node.marks?.map((mark) =>
      mark.type === 'link' && typeof mark.attrs?.href === 'string'
        ? {
            ...mark,
            attrs: { ...mark.attrs, href: writableAddress(mark.attrs.href) },
          }
        : mark,
    ),
    content: node.content?.map(withWritableLinks),
  }
}

export function markdownOf(editor: Editor): string {
  if (editor.isEmpty || editor.state.doc.textContent.trim() === '') return ''
  const writer = typedTextWriter(editor) as unknown as {
    serialize(json: unknown): string
  }
  return writer.serialize(withWritableLinks(editor.getJSON())).trim()
}
