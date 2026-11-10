import type { Editor } from '@tiptap/react'

// The editor writes > < & as &gt; &lt; &amp;. Typed text is kept as typed
// (the Markdown reader takes HTML as text, see ./markdown), apart from what
// Markdown itself would read differently:
// - "&" before something that reads as an entity ("&amp;lt;" for a typed
//   "&lt;"), or it would come back as "<";
// - ">" at the start of a line, which would be a quote ("\>").
// Code is taken literally by Markdown, and the editor does not escape it.
const ENTITY = /&(amp|lt|gt);/g
const CODE = /`[^`\n]*`/g

function unescapeText(text: string): string {
  return text.replace(ENTITY, (match, name: string, at: number) => {
    if (name === 'lt') return '<'
    if (name === 'amp') {
      return /^[#\w]+;/.test(text.slice(at + match.length)) ? match : '&'
    }
    return /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', at) + 1, at))
      ? '\\>'
      : '>'
  })
}

function unescapeEntities(markdown: string): string {
  let result = ''
  let from = 0
  for (const code of markdown.matchAll(CODE)) {
    result += unescapeText(markdown.slice(from, code.index))
    result += code[0]
    from = code.index + code[0].length
  }
  return result + unescapeText(markdown.slice(from))
}

export function markdownOf(editor: Editor): string {
  return editor.isEmpty ? '' : unescapeEntities(editor.getMarkdown()).trim()
}
