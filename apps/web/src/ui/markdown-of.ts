import type { Editor } from '@tiptap/react'

// The editor writes > < & as &gt; &lt; &amp;. A message or description keeps them as typed.
function unescapeEntities(markdown: string): string {
  const characters = { amp: '&', lt: '<', gt: '>' }
  return markdown.replace(
    /&(amp|lt|gt);/g,
    (_, name: keyof typeof characters) => characters[name],
  )
}

export function markdownOf(editor: Editor): string {
  return editor.isEmpty ? '' : unescapeEntities(editor.getMarkdown()).trim()
}
