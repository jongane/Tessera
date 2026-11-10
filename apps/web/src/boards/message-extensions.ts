import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '../ui/markdown'
import { isSafeLink } from './message-text'

// The message box's formatting: what the box can hold (no headings, quotes,
// code blocks, dividers, strike or underline).
export function messageExtensions() {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        // A typed www.example.org gets https:// in front, so check it so.
        isAllowedUri: (url, { defaultProtocol }) =>
          isSafeLink(
            /^[a-z][a-z0-9+.-]*:/i.test(url)
              ? url
              : `${defaultProtocol}://${url}`,
          ),
        HTMLAttributes: {
          class: 'text-accent underline',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      },
    }),
    Markdown,
  ]
}

// Whether the message box can hold this Markdown whole: everything in it is a
// paragraph, a list, bold, italic, code in a line, a link or a line break. It
// cannot hold a heading, a quote, a code block, a divider, a table, an image,
// a task list or a footnote, which it would leave out or write differently:
// those are edited as plain text instead. (The Markdown is read the way the
// box reads it, rather than written back and compared, as the box writes
// text with escapes, so a body it wrote itself is not written back the same.)
const HELD = new Set([
  'space',
  'paragraph',
  'text',
  'list',
  'list_item',
  'strong',
  'em',
  'codespan',
  'link',
  'br',
  'escape',
])

interface Token {
  type: string
  task?: boolean
  tokens?: Token[]
  items?: Token[]
}

const reader = new MarkdownManager({ extensions: [] })

export function canHoldInMessageBox(markdown: string): boolean {
  const held = (tokens: Token[] | undefined): boolean =>
    (tokens ?? []).every(
      (token) =>
        HELD.has(token.type) &&
        !token.task &&
        held(token.tokens) &&
        held(token.items),
    )
  try {
    return held(reader.instance.lexer(markdown) as Token[])
  } catch {
    // Too deep to read.
    return false
  }
}
