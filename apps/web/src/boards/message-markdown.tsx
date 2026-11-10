import { Markdown } from '@tiptap/markdown'
import { Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useQueries } from '@tanstack/react-query'
import { Fragment, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { cardByNumberQuery } from '../api/boards'
import { MESSAGE_MAX_LEVELS, nestingLevels } from '@tessera/shared'
import { CARD_NUMBER_IN_TEXT, isSafeLink } from './message-text'

// A message's Markdown, shown as formatted text. It is read with the same
// Markdown rules as the card description (Tiptap), then drawn here, so that
// only the links we allow are ever drawn.

let parser: Editor | undefined

function parse(markdown: string): JSONContent {
  // One editor that is never shown, made on first use, only to read Markdown.
  parser ??= new Editor({ extensions: [StarterKit, Markdown] })
  return parser.markdown?.parse(markdown) ?? { type: 'doc', content: [] }
}

function hasMark(node: JSONContent, type: string) {
  return node.marks?.some((mark) => mark.type === type) ?? false
}

// At most this many different card numbers of a message are looked up.
const MAX_CARD_NUMBERS = 20

// A table has no toolbar button, and the Markdown reader drops it.
const TABLE_SEPARATOR =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/

// Whether a line of the text is a table's separator row. Read line by line,
// so a long text cannot make the pattern slow.
function hasTable(markdown: string): boolean {
  return markdown.split('\n').some((line) => TABLE_SEPARATOR.test(line))
}

// All the text of `node` and its children.
function textOf(node: JSONContent): string {
  return (
    (node.text ?? '') +
    (node.content ?? []).map((child) => textOf(child)).join('')
  )
}

// The card numbers written in the text of `node` and its children, outside
// code and links.
function cardNumbersIn(node: JSONContent, found = new Set<string>()) {
  if (
    node.type === 'text' &&
    !hasMark(node, 'code') &&
    !hasMark(node, 'link')
  ) {
    for (const match of node.text?.matchAll(CARD_NUMBER_IN_TEXT) ?? []) {
      found.add(match[0])
    }
  }
  node.content?.forEach((child) => cardNumbersIn(child, found))
  return found
}

// Card number -> the card's id, for the numbers of this project's cards.
type KnownCards = ReadonlyMap<string, string>

export function MessageBody({
  markdown,
  projectId,
}: {
  markdown: string
  projectId: string
}) {
  // Nested too deeply to draw safely, or something the reader drops (a
  // table) or leaves empty: the text is shown as it was written.
  const tooDeep = nestingLevels(markdown) > MESSAGE_MAX_LEVELS
  const doc = tooDeep ? EMPTY_DOC : parse(markdown)
  const asWritten = tooDeep || hasTable(markdown) || textOf(doc).trim() === ''
  const numbers = asWritten
    ? []
    : [...cardNumbersIn(doc)].slice(0, MAX_CARD_NUMBERS)
  const known: KnownCards = new Map(
    useQueries({
      queries: numbers.map((number) => ({
        ...cardByNumberQuery(number),
        // Everyone who writes WEB-12 shares one lookup.
        staleTime: 60_000,
      })),
      combine: (results) =>
        results.flatMap((result, index): [string, string][] =>
          result.data?.projectId === projectId
            ? [[numbers[index]!, result.data.id]]
            : [],
        ),
    }),
  )
  return asWritten ? (
    <PlainBody markdown={markdown} />
  ) : (
    <div className="flex flex-col gap-1">{blocks(doc.content, known)}</div>
  )
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

// The text as it was written, Markdown marks and all.
export function PlainBody({ markdown }: { markdown: string }) {
  return <p className="break-words whitespace-pre-wrap">{markdown}</p>
}

function blocks(nodes: JSONContent[] | undefined, known: KnownCards) {
  return nodes?.map((node, index) => (
    <Fragment key={index}>{block(node, known)}</Fragment>
  ))
}

function block(node: JSONContent, known: KnownCards): ReactNode {
  if (node.type === 'text' || node.type === 'hardBreak') {
    return inline(node, known)
  }
  const inner = () => inlines(node.content, known)
  switch (node.type) {
    case 'paragraph':
      return <p className="break-words whitespace-pre-wrap">{inner()}</p>
    case 'heading':
      return <p className="font-semibold break-words">{inner()}</p>
    case 'bulletList':
      return <ul className="list-disc pl-5">{blocks(node.content, known)}</ul>
    case 'orderedList':
      return (
        <ol className="list-decimal pl-5" start={node.attrs?.start as number}>
          {blocks(node.content, known)}
        </ol>
      )
    case 'listItem':
      return <li>{blocks(node.content, known)}</li>
    case 'blockquote':
      return (
        <blockquote className="border-l-4 border-line pl-3">
          {blocks(node.content, known)}
        </blockquote>
      )
    case 'codeBlock':
      return (
        <pre className="overflow-x-auto rounded bg-subtle p-2">
          <code>{node.content?.map((child) => child.text).join('')}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr className="border-line" />
    default:
      return <p className="break-words">{inner()}</p>
  }
}

function inlines(nodes: JSONContent[] | undefined, known: KnownCards) {
  return nodes?.map((node, index) => (
    <Fragment key={index}>{inline(node, known)}</Fragment>
  ))
}

function inline(node: JSONContent, known: KnownCards): ReactNode {
  if (node.type === 'hardBreak') {
    return <br />
  }
  const text = node.text ?? ''
  const link = node.marks?.find((mark) => mark.type === 'link')
  const plain =
    hasMark(node, 'code') || link ? text : withCardLinks(text, known)
  return (node.marks ?? []).reduce<ReactNode>((wrapped, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{wrapped}</strong>
      case 'italic':
        return <em>{wrapped}</em>
      case 'strike':
        return <s>{wrapped}</s>
      case 'code':
        return <code className="rounded bg-subtle px-1">{wrapped}</code>
      case 'link': {
        const href = mark.attrs?.href as string | undefined
        // A link we do not allow is shown as its text.
        return isSafeLink(href) ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {wrapped}
          </a>
        ) : (
          wrapped
        )
      }
      default:
        return wrapped
    }
  }, plain)
}

// The text, with each card number of this project as a link to its card.
function withCardLinks(text: string, known: KnownCards): ReactNode {
  const parts: ReactNode[] = []
  let from = 0
  for (const match of text.matchAll(CARD_NUMBER_IN_TEXT)) {
    const cardId = known.get(match[0])
    if (cardId === undefined) {
      continue
    }
    parts.push(text.slice(from, match.index))
    parts.push(<CardLink key={match.index} number={match[0]} cardId={cardId} />)
    from = match.index + match[0].length
  }
  if (parts.length === 0) {
    return text
  }
  parts.push(text.slice(from))
  return parts
}

// Opens the card's panel next to whatever is open, the chat included.
function CardLink({ number, cardId }: { number: string; cardId: string }) {
  const [searchParams] = useSearchParams()
  const next = new URLSearchParams(searchParams)
  next.set('card', cardId)
  return (
    <Link
      to={{ search: `?${next}` }}
      className="font-semibold text-accent hover:text-accent-strong hover:underline"
    >
      {number}
    </Link>
  )
}
