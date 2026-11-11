import { Markdown } from '@tiptap/markdown'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { markdownOf } from './markdown-of'

// Writing the editor's text as Markdown must take time in proportion to its
// length: a 50,000-character description is written every time it is saved
// (and read by everyone who opens it), so a pattern that grows with the
// square of the text freezes the page (found in review, round 5).
function editorHolding(text: string) {
  return new Editor({
    extensions: [StarterKit, Markdown],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  })
}

const BOUND_MS = 150
const LONG = 50_000

describe('markdownOf takes time in proportion to the text (criterion 43)', () => {
  it.each([
    ['a "<" followed by many ":"', '<' + ':'.repeat(LONG)],
    ['a "<" followed by many ":" and an "x"', '<' + ':'.repeat(LONG) + 'x'],
    ['"|-" followed by many spaces', '|-' + ' '.repeat(LONG)],
    ['"|-" followed by many spaces and an "x"', '|-' + ' '.repeat(LONG) + 'x'],
    ['many "|-" pairs', '|-'.repeat(LONG / 2) + 'x'],
    ['many "@" signs', 'a@'.repeat(LONG / 2)],
    ['many "http://" starts', 'http://'.repeat(LONG / 7)],
  ])('writes %s quickly', (_name, text) => {
    const editor = editorHolding(text)

    const started = performance.now()
    const markdown = markdownOf(editor)
    const took = performance.now() - started

    expect(markdown.length).toBeGreaterThan(0)
    expect(took).toBeLessThan(BOUND_MS)
    editor.destroy()
  })
})
