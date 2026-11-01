import { Markdown } from '@tiptap/markdown'
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Button } from '../ui/Button'

// The card's description: rich text with a formatting toolbar (Tiptap),
// stored as Markdown (docs/card-features.md, section 2). Edited only after
// "Edit description", and kept with Save or Cancel (docs/web-app.md,
// section 5).

const extensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: { class: 'text-accent underline' },
    },
  }),
  Markdown,
]

// Tailwind resets headings and lists, so the description styles its own.
const proseClass =
  '[&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-subtle [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc flex flex-col gap-2'

export function DescriptionField({
  description,
  onSave,
  onEditingChange,
}: {
  description: string | null
  onSave: (markdown: string) => void
  // Tells the panel while there are unsaved changes.
  onEditingChange: (unsaved: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 id={headingId} className="font-semibold">
          Description
        </h3>
        {!editing && (
          <Button
            variant="link"
            className="min-h-8 text-sm"
            onClick={() => setEditing(true)}
          >
            Edit description
          </Button>
        )}
      </div>
      {editing ? (
        <DescriptionEditor
          description={description ?? ''}
          onChange={onEditingChange}
          onDone={(markdown) => {
            if (markdown !== null && markdown !== (description ?? '')) {
              onSave(markdown)
            }
            onEditingChange(false)
            setEditing(false)
          }}
        />
      ) : description ? (
        <ReadOnlyDescription markdown={description} />
      ) : (
        <p className="text-muted">No description yet.</p>
      )}
    </section>
  )
}

function ReadOnlyDescription({ markdown }: { markdown: string }) {
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    editable: false,
    // Plain text to read, not a text box: Tiptap marks every editor as one.
    editorProps: { attributes: { class: proseClass, role: 'none' } },
  })
  // Shows a newer description after a reload.
  useEffect(() => {
    if (editor && editor.getMarkdown() !== markdown) {
      editor.commands.setContent(markdown, { contentType: 'markdown' })
    }
  }, [editor, markdown])
  return <EditorContent editor={editor} />
}

function DescriptionEditor({
  description,
  onChange,
  onDone,
}: {
  description: string
  onChange: (unsaved: boolean) => void
  // The new text, or null to keep the old one.
  onDone: (markdown: string | null) => void
}) {
  const [asking, setAsking] = useState(false)
  const editor = useEditor({
    extensions,
    content: description,
    contentType: 'markdown',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: `${proseClass} min-h-32 rounded-lg border border-line-strong bg-surface p-3`,
        'aria-label': 'Description',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: changed }) =>
      onChange(markdownOf(changed) !== description),
  })

  function cancel() {
    if (editor && markdownOf(editor) !== description) {
      setAsking(true)
    } else {
      onDone(null)
    }
  }

  if (!editor) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {asking ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <span>Discard your changes?</span>
          <Button onClick={() => onDone(null)}>Discard</Button>
          <Button variant="secondary" onClick={() => setAsking(false)}>
            Keep editing
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => onDone(markdownOf(editor))}>Save</Button>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function markdownOf(editor: Editor): string {
  return editor.isEmpty ? '' : editor.getMarkdown().trim()
}

const BUTTONS = [
  {
    name: 'Bold',
    mark: 'bold',
    run: (e: Editor) => e.chain().focus().toggleBold().run(),
    look: 'B',
  },
  {
    name: 'Italic',
    mark: 'italic',
    run: (e: Editor) => e.chain().focus().toggleItalic().run(),
    look: 'I',
  },
  {
    name: 'Strikethrough',
    mark: 'strike',
    run: (e: Editor) => e.chain().focus().toggleStrike().run(),
    look: 'S',
  },
  {
    name: 'Heading',
    mark: 'heading',
    run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    look: 'H',
  },
  {
    name: 'Bullet list',
    mark: 'bulletList',
    run: (e: Editor) => e.chain().focus().toggleBulletList().run(),
    look: '•',
  },
  {
    name: 'Numbered list',
    mark: 'orderedList',
    run: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    look: '1.',
  },
  {
    name: 'Quote',
    mark: 'blockquote',
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
    look: '❝',
  },
  {
    name: 'Code',
    mark: 'code',
    run: (e: Editor) => e.chain().focus().toggleCode().run(),
    look: '</>',
  },
] as const

const toolButton =
  'flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 font-semibold hover:bg-subtle aria-pressed:bg-accent-soft aria-pressed:text-accent-strong'

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      Object.fromEntries(
        [...BUTTONS.map((b) => b.mark), 'link'].map((mark) => [
          mark,
          e.isActive(mark),
        ]),
      ),
  })
  const [linking, setLinking] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-subtle p-1"
      >
        {BUTTONS.map((button) => (
          <button
            key={button.name}
            type="button"
            aria-label={button.name}
            aria-pressed={active?.[button.mark] ?? false}
            title={button.name}
            onClick={() => button.run(editor)}
            className={toolButton}
          >
            <span aria-hidden="true">{button.look}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Link"
          aria-pressed={active?.link ?? false}
          aria-expanded={linking}
          title="Link"
          onClick={() => setLinking(!linking)}
          className={toolButton}
        >
          <span aria-hidden="true">🔗</span>
        </button>
      </div>
      {linking && <LinkForm editor={editor} onDone={() => setLinking(false)} />}
    </div>
  )
}

// Adds a link to the selected text, or changes or removes the one there.
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const id = useId()
  const [href, setHref] = useState(
    (editor.getAttributes('link').href as string | undefined) ?? '',
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href.trim() === '') {
      chain.unsetLink().run()
    } else {
      chain.setLink({ href: href.trim() }).run()
    }
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="font-semibold">
          Link address
        </label>
        <input
          id={id}
          type="url"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          placeholder="https://"
          className="min-h-11 rounded-lg border border-line-strong px-3"
        />
      </div>
      <Button type="submit">Apply</Button>
      <Button variant="secondary" onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}
