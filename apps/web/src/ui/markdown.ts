import { Markdown, MarkdownManager } from '@tiptap/markdown'

// What is typed is never HTML: the Markdown reader, shared by the card
// description and the chat messages, reads `<div>` or `a<b and c>d` as the
// text that was typed. Without this it would take them for HTML tags and
// drop them.
new MarkdownManager({ extensions: [] }).instance.use({
  tokenizer: {
    // Returning nothing means "not HTML": the text is read as text.
    html: () => undefined,
    tag: () => undefined,
  },
})

export { Markdown }
