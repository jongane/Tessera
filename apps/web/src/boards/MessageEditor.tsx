import { Markdown } from '@tiptap/markdown'
import { type Editor, EditorContent, Extension, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type ReactNode, useEffect, useState } from 'react'
import { EditorToolbar, type ToolbarButton } from '../ui/editor-toolbar'
import { isSafeLink, markdownOf } from './message-text'

// The rich-text box for writing or editing a message (Tiptap), stored as
// Markdown, like the card description but with a smaller set of formatting
// (docs/web-app.md, section 3). Enter sends (or saves), Shift+Enter starts
// a new line, or a new item in a list.

const BUTTONS: readonly ToolbarButton[] = [
  {
    name: 'Bold',
    mark: 'bold',
    run: (e) => e.chain().focus().toggleBold().run(),
    look: 'B',
  },
  {
    name: 'Italic',
    mark: 'italic',
    run: (e) => e.chain().focus().toggleItalic().run(),
    look: 'I',
  },
  {
    name: 'Code',
    mark: 'code',
    run: (e) => e.chain().focus().toggleCode().run(),
    look: '</>',
  },
  {
    name: 'Bulleted list',
    mark: 'bulletList',
    run: (e) => e.chain().focus().toggleBulletList().run(),
    look: '•',
  },
  {
    name: 'Numbered list',
    mark: 'orderedList',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    look: <NumberedListIcon />,
  },
]

interface Keys {
  onEnter: (editor: Editor) => void
  onEscape?: () => void
}

// Enter sends; Shift+Enter is a new line, or the next list item. The
// handlers are set from outside, as they change with every drawing.
function keyboard() {
  let handlers: Keys = { onEnter: () => {} }
  const extension = Extension.create({
    name: 'messageKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          handlers.onEnter(editor)
          return true
        },
        'Shift-Enter': ({ editor }) =>
          editor.isActive('listItem')
            ? editor.commands.splitListItem('listItem')
            : editor.commands.setHardBreak(),
        Escape: () => {
          handlers.onEscape?.()
          return handlers.onEscape !== undefined
        },
      }
    },
  })
  return {
    extension,
    setHandlers: (latest: Keys) => {
      handlers = latest
    },
  }
}

export function MessageEditor({
  label,
  initial,
  autofocus,
  onEnter,
  onEscape,
  onChange,
  children,
}: {
  // The box's accessible name.
  label: string
  // Markdown.
  initial: string
  autofocus?: boolean
  onEnter: (editor: Editor) => void
  onEscape?: () => void
  onChange?: (markdown: string) => void
  // Under the box: the buttons and any problem.
  children?: (editor: Editor) => ReactNode
}) {
  // The latest handlers: the editor is made only once.
  const [keys] = useState(() => keyboard())
  useEffect(() => {
    keys.setHandlers({ onEnter, onEscape })
  })
  const editor = useEditor({
    extensions: [
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
      keys.extension,
    ],
    content: initial,
    contentType: 'markdown',
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        class:
          'max-h-40 min-h-11 overflow-y-auto rounded-lg border border-line-strong bg-surface px-3 py-2 break-words [&_code]:rounded [&_code]:bg-subtle [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:min-h-6 [&_ul]:list-disc',
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: changed }) => onChange?.(markdownOf(changed)),
  })
  if (!editor) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <EditorToolbar
        editor={editor}
        label={`${label} formatting`}
        buttons={BUTTONS}
      />
      <EditorContent editor={editor} />
      {children?.(editor)}
    </div>
  )
}

// Three numbered lines. Drawn, as the digit "1." would not be part of the
// button's name.
function NumberedListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <rect x="1" y="2" width="3" height="3" />
      <rect x="1" y="6.5" width="3" height="3" />
      <rect x="1" y="11" width="3" height="3" />
      <rect x="6" y="2.5" width="9" height="2" />
      <rect x="6" y="7" width="9" height="2" />
      <rect x="6" y="11.5" width="9" height="2" />
    </svg>
  )
}
