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
  // The list items above, each one nested in the one before: the column of
  // the mark, and of the text after it.
  const open: { indent: number; content: number }[] = [];
  // The code block we are in, if any.
  let fence: Fence | null = null;
  let afterBlank = true;
  let inIndentedCode = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.includes('\t') ? raw.replace(/\t/g, '    ') : raw;
    const lineIndent = spacesAt(line, 0);
    const blank = lineIndent === line.length;
    if (fence) {
      if (blank && !fence.inQuote) {
        continue;
      }
      const at = stripContainers(line, fence.containers);
      if (at >= 0) {
        if (closesFence(line, at, fence)) {
          fence = null;
        }
        continue;
      }
      // The quote or list item the code block was in has ended, and with it
      // the code block: this line is read as any other.
      fence = null;
    }
    if (blank) {
      afterBlank = true;
      continue;
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

    // The quote and list marks at the start of the line, in order, each with
    // the column after it (for a list mark, after its spaces).
    const marked: { quote: boolean; after: number }[] = [];
    let quotes = 0;
    let marks = 0;
    let indent = lineIndent;
    let listIndent = -1;
    // Each list mark's column and its text's column, from the start of the
    // quote it is in (or the line).
    const items: { indent: number; content: number }[] = [];
    let frame = 0;
    let at = lineIndent;
    for (;;) {
      const char = line[at];
      if (char === '>') {
        quotes += 1;
        at += 1;
        marked.push({ quote: true, after: at });
        frame = at;
        indent = spacesAt(line, at);
        at += indent;
      } else if (isListMark(line, at)) {
        if (marks === 0 && isDivider(line, at)) {
          break;
        }
        const markAt = at - frame;
        if (listIndent < 0) {
          listIndent = markAt;
        }
        marks += 1;
        at += listMarkLength(line, at);
        const spaces = spacesAt(line, at);
        at += spaces;
        // With five spaces or more, the text is indented code in the item.
        const after = spaces > 4 ? at - spaces + 1 : at;
        marked.push({ quote: false, after });
        items.push({ indent: markAt, content: after - frame });
      } else {
        break;
      }
    }
    let enclosing: { indent: number; content: number } | undefined;
    // Quotes together with list items above: the columns of both are mixed
    // up, so no code block is recognised there (what is in it counts).
    let unclear = false;
    if (marks === 0) {
      if (quotes === 0 && lineIndent === 0) {
        open.length = 0;
      }
      // Text indented under the list items above counts as inside them.
      let inside = 0;
      while (inside < open.length && open[inside]!.indent < indent) {
        inside += 1;
      }
      deepest = Math.max(deepest, quotes + inside);
      if (quotes === 0) {
        for (let i = inside - 1; i >= 0; i -= 1) {
          if (open[i]!.content <= indent) {
            enclosing = open[i];
            break;
          }
        }
      } else {
        unclear = inside > 0;
      }
    } else {
      while (open.length > 0 && open[open.length - 1]!.indent >= listIndent) {
        open.pop();
      }
      deepest = Math.max(deepest, quotes + open.length + marks);
      if (quotes === 0) {
        enclosing = open[open.length - 1];
      } else {
        unclear = open.length > 0;
      }
    }
    if (!unclear) {
      fence = fenceOpenedBy(line, marked, enclosing, lineIndent);
    }
    // Each mark opens a list item inside the one before it.
    open.push(...items);
  }
  return deepest;
}

const QUOTE = 'quote';
// What a line in a code block must start with to still be in the quote or
// list item the code block is in: a quote mark, or this many spaces.
type Container = typeof QUOTE | number;

interface Fence {
  char: string;
  length: number;
  containers: Container[];
  inQuote: boolean;
}

function spacesAt(line: string, from: number): number {
  let at = from;
  while (line[at] === ' ') {
    at += 1;
  }
  return at - from;
}

// The code block that this line opens, in the quotes and list items that its
// marks (and the list item it is under) put it in.
function fenceOpenedBy(
  line: string,
  marked: { quote: boolean; after: number }[],
  enclosing: { content: number } | undefined,
  lineIndent: number,
): Fence | null {
  const containers: Container[] = [];
  let column = 0;
  if (enclosing) {
    column = Math.min(enclosing.content, lineIndent);
    containers.push(column);
  }
  for (const mark of marked) {
    containers.push(mark.quote ? QUOTE : mark.after - column);
    column = mark.after;
  }
  // One space after a quote mark belongs to the quote.
  if (marked.length > 0 && marked[marked.length - 1]!.quote) {
    column += line[column] === ' ' ? 1 : 0;
  }
  const indent = spacesAt(line, column);
  if (indent > 3) {
    return null;
  }
  const opened = opensFence(line, column + indent);
  return (
    opened && { ...opened, containers, inQuote: containers.includes(QUOTE) }
  );
}

// Where the text of a line in a code block starts, once the quote marks and
// the indent of the quotes and list items it is in are taken off; or -1 if
// the line is not in them (so they, and the code block, have ended).
function stripContainers(line: string, containers: Container[]): number {
  let at = 0;
  for (const container of containers) {
    if (container === QUOTE) {
      const spaces = spacesAt(line, at);
      if (spaces > 3 || line[at + spaces] !== '>') {
        return -1;
      }
      at += spaces + 1;
    } else {
      if (spacesAt(line, at) < container) {
        return -1;
      }
      at += container;
    }
  }
  if (containers[containers.length - 1] === QUOTE && line[at] === ' ') {
    at += 1;
  }
  return at;
}

// "```" or "~~~" (three or more), up to three spaces in. The text after a
// backtick fence cannot hold a backtick: "```a```" is code in a line.
function opensFence(line: string, at: number) {
  const char = line[at];
  if (char !== '`' && char !== '~') {
    return null;
  }
  let end = at;
  while (line[end] === char) {
    end += 1;
  }
  if (end - at < 3 || (char === '`' && line.indexOf('`', end) >= 0)) {
    return null;
  }
  return { char, length: end - at };
}

function closesFence(
  line: string,
  from: number,
  fence: { char: string; length: number },
): boolean {
  const at = from + spacesAt(line, from);
  if (at - from > 3 || line[at] !== fence.char) {
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
