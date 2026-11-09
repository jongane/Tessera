import { type Editor, useEditorState } from '@tiptap/react'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Button } from './Button'

// The formatting toolbar of a rich-text box (Tiptap) and its link form, used
// by the card description and the chat message box.

export interface ToolbarButton {
  name: string
  // The Tiptap mark or node that shows the button as pressed.
  mark: string
  run: (editor: Editor) => unknown
  // What the button shows. Text must be part of the name (WCAG 2.5.3), so a
  // number is drawn as an icon instead.
  look: ReactNode
}

const toolButton =
  'flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 font-semibold hover:bg-subtle aria-pressed:bg-accent-soft aria-pressed:text-accent-strong'

export function EditorToolbar({
  editor,
  label,
  buttons,
}: {
  editor: Editor
  // The toolbar's accessible name.
  label: string
  buttons: readonly ToolbarButton[]
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      Object.fromEntries(
        [...buttons.map((b) => b.mark), 'link'].map((mark) => [
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
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-subtle p-1"
      >
        {buttons.map((button) => (
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
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        // Closes only this form, not the card panel around it.
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onDone()
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="font-semibold">
          Link address
        </label>
        <input
          id={id}
          type="url"
          autoFocus
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
