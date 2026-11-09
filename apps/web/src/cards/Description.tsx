import { Markdown } from '@tiptap/markdown'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cardChangesSchema } from '@tessera/shared'
import { useEffect, useId, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EditorToolbar, type ToolbarButton } from '../ui/editor-toolbar'
import { checkForm } from '../ui/form-errors'

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
  // Resolves once saved. Until then the editor stays open, and if saving
  // fails it keeps what was written.
  onSave: (markdown: string) => Promise<unknown>
  // Tells the panel while there are unsaved changes.
  onEditingChange: (unsaved: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const headingId = useId()

  function finish() {
    onEditingChange(false)
    setEditing(false)
  }

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
          saving={saving}
          onChange={onEditingChange}
          onDone={(markdown) => {
            if (markdown === null || markdown === (description ?? '')) {
              finish()
              return
            }
            setSaving(true)
            onSave(markdown)
              .then(finish, () => {})
              .finally(() => setSaving(false))
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
  saving,
  onChange,
  onDone,
}: {
  description: string
  saving: boolean
  onChange: (unsaved: boolean) => void
  // The new text, or null to keep the old one.
  onDone: (markdown: string | null) => void
}) {
  const [asking, setAsking] = useState(false)
  const [tooLong, setTooLong] = useState<string>()
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

  function save(editor: Editor) {
    const markdown = markdownOf(editor)
    const checked = checkForm(cardChangesSchema, { description: markdown })
    if (!checked.ok) {
      setTooLong(checked.errors.description ?? 'Check the description')
      return
    }
    setTooLong(undefined)
    onDone(markdown)
  }

  if (!editor) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <EditorToolbar editor={editor} label="Formatting" buttons={BUTTONS} />
      <EditorContent editor={editor} />
      {tooLong && <Alert>{tooLong}</Alert>}
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
          <Button disabled={saving} onClick={() => save(editor)}>
            Save
          </Button>
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

const BUTTONS: readonly ToolbarButton[] = [
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
]
