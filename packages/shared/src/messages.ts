import { z } from 'zod';
import { textWithoutNul } from './text.js';

// The text of a chat message, as Markdown. Used when a message is sent and
// when it is edited.
export const MESSAGE_BODY_MAX = 10_000;

export const MESSAGE_MAX_LEVELS = 10;

// How deeply lists and quotes (counted together) are nested in a Markdown
// text, counted the way Markdown reads it: ">" needs no space after it, a
// list can be nested by indenting, also inside a quote, and nothing in a
// code block (fenced or indented) or in a divider line such as "- - -" is a
// list or a quote. Where Markdown is unclear, it counts more, not less. The
// text is read line by line and each line once, with no recursion, so a huge
// text is decided quickly and cannot overflow the stack.
export function nestingLevels(markdown: string): number {
  let deepest = 0;
  // The indents of the list items above, each one nested in the one before.
  const open: number[] = [];
  // The fence that opened the code block we are in, as its character and length.
  let fence: { char: string; length: number } | null = null;
  let afterBlank = true;
  let inIndentedCode = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.includes('\t') ? raw.replace(/\t/g, '    ') : raw;
    const lineIndent = spacesAt(line, 0);
    const blank = lineIndent === line.length;
    if (fence) {
      if (closesFence(line, lineIndent, fence)) {
        fence = null;
      }
      continue;
    }
    if (blank) {
      afterBlank = true;
      continue;
    }
    if (lineIndent <= 3) {
      fence = opensFence(line, lineIndent);
      if (fence) {
        afterBlank = false;
        continue;
      }
    }
    if (
      lineIndent >= 4 &&
      open.length === 0 &&
      (afterBlank || inIndentedCode)
    ) {
      inIndentedCode = true;
      afterBlank = false;
      continue;
    }
    inIndentedCode = false;
    afterBlank = false;

    let quotes = 0;
    let marks = 0;
    let indent = lineIndent;
    let listIndent = -1;
    let at = lineIndent;
    for (;;) {
      const char = line[at];
      if (char === '>') {
        quotes += 1;
        at += 1;
        indent = spacesAt(line, at);
        at += indent;
      } else if (isListMark(line, at)) {
        if (marks === 0 && isDivider(line, at)) {
          break;
        }
        if (listIndent < 0) {
          listIndent = indent;
        }
        marks += 1;
        at += listMarkLength(line, at);
        at += spacesAt(line, at);
      } else {
        break;
      }
    }
    if (marks === 0) {
      if (quotes === 0 && lineIndent === 0) {
        open.length = 0;
      }
      // Text indented under the list items above counts as inside them.
      let inside = 0;
      while (inside < open.length && open[inside]! < indent) {
        inside += 1;
      }
      deepest = Math.max(deepest, quotes + inside);
      continue;
    }
    while (open.length > 0 && open[open.length - 1]! >= listIndent) {
      open.pop();
    }
    deepest = Math.max(deepest, quotes + open.length + marks);
    open.push(listIndent);
  }
  return deepest;
}

function spacesAt(line: string, from: number): number {
  let at = from;
  while (line[at] === ' ') {
    at += 1;
  }
  return at - from;
}

// "```" or "~~~" (three or more), up to three spaces in.
function opensFence(line: string, at: number) {
  const char = line[at];
  if (char !== '`' && char !== '~') {
    return null;
  }
  let end = at;
  while (line[end] === char) {
    end += 1;
  }
  return end - at >= 3 ? { char, length: end - at } : null;
}

function closesFence(
  line: string,
  at: number,
  fence: { char: string; length: number },
): boolean {
  if (at > 3 || line[at] !== fence.char) {
    return false;
  }
  let end = at;
  while (line[end] === fence.char) {
    end += 1;
  }
  return end - at >= fence.length && spacesAt(line, end) === line.length - end;
}

// A bullet ("-", "*", "+") or a number ("1." or "1)") followed by a space or
// the end of the line.
function isListMark(line: string, at: number): boolean {
  return listMarkLength(line, at) > 0;
}

function listMarkLength(line: string, at: number): number {
  const char = line[at];
  if (char === '-' || char === '*' || char === '+') {
    return line[at + 1] === undefined || line[at + 1] === ' ' ? 1 : 0;
  }
  let end = at;
  while (line[end] !== undefined && line[end]! >= '0' && line[end]! <= '9') {
    end += 1;
  }
  const digits = end - at;
  if (digits < 1 || digits > 9 || (line[end] !== '.' && line[end] !== ')')) {
    return 0;
  }
  return line[end + 1] === undefined || line[end + 1] === ' ' ? digits + 1 : 0;
}

// Three or more of "-", "*" or "_", with spaces between and nothing else.
function isDivider(line: string, at: number): boolean {
  const char = line[at];
  if (char !== '-' && char !== '*' && char !== '_') {
    return false;
  }
  let count = 0;
  for (let i = at; i < line.length; i += 1) {
    if (line[i] === char) {
      count += 1;
    } else if (line[i] !== ' ') {
      return false;
    }
  }
  return count >= 3;
}

export const messageBodySchema = textWithoutNul()
  .trim()
  .min(1)
  .max(MESSAGE_BODY_MAX, `Use at most ${MESSAGE_BODY_MAX} characters`)
  .refine((body) => nestingLevels(body) <= MESSAGE_MAX_LEVELS, {
    message: `Use at most ${MESSAGE_MAX_LEVELS} levels of lists and quotes`,
  });

export const messageBodyRequestSchema = z.strictObject({
  body: messageBodySchema,
});

export type MessageBodyRequest = z.infer<typeof messageBodyRequestSchema>;

// GET /api/chats/:chatId/messages?before=<messageId>
export const messagePageQuerySchema = z.strictObject({
  before: z.uuid().optional(),
});

export type MessagePageQuery = z.infer<typeof messagePageQuerySchema>;

// POST /api/chats/:chatId/messages. The browser may give the message an id, so
// that sending it again (Try again) never saves it twice.
export const newMessageSchema = z.strictObject({
  body: messageBodySchema,
  id: z.uuid().optional(),
});

export type NewMessageBody = z.infer<typeof newMessageSchema>;
