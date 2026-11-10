import { Editor, type JSONContent } from '@tiptap/react'
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

// Whether the message box can hold this Markdown whole. It cannot hold a
// heading, a table or an image, which it would leave out: those are edited as
// plain text instead.
export function canHoldInMessageBox(markdown: string): boolean {
  const reader = new Editor({ extensions: messageExtensions() })
  try {
    const { nodes, marks } = reader.schema
    const holds = (node: JSONContent): boolean =>
      (node.type === undefined || node.type in nodes) &&
      (node.marks ?? []).every((mark) => mark.type in marks) &&
      (node.content ?? []).every(holds)
    return holds(reader.markdown!.parse(markdown))
  } catch {
    return false
  } finally {
    reader.destroy()
  }
}
