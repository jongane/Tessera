import {
  Markdown as MarkdownExtension,
  type MarkdownExtensionOptions,
} from '@tiptap/markdown'
import { Marked } from 'marked'

// What is typed is never HTML: the Markdown reader, shared by the card
// description and the chat messages (the editors, the message renderer and the
// check of what the message box can hold), reads `<div>` or `a<b and c>d` as
// the text that was typed. Without this it would take them for HTML tags and
// drop them. It is this app's own reader: marked's shared, global one is left
// as it is.
export const reader = new Marked({
  tokenizer: {
    // Returning nothing means "not HTML": the text is read as text.
    html: () => undefined,
    tag: () => undefined,
  },
})

// Tiptap's `marked` option is typed as the global `marked` function; a
// `Marked` instance has the same methods that Tiptap uses.
export const tiptapReader =
  reader as unknown as MarkdownExtensionOptions['marked']

export const Markdown = MarkdownExtension.configure({ marked: tiptapReader })
