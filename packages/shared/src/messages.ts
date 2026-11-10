import { z } from 'zod';
import { textWithoutNul } from './text.js';

// The text of a chat message, as Markdown. Used when a message is sent and
// when it is edited.
export const MESSAGE_BODY_MAX = 10_000;

export const MESSAGE_MAX_LEVELS = 10;

// A line's leading quote or list mark: ">", "-", "*", "+", "1." or "1)".
const LEADING_MARK = /^( *)(?:>|[-*+]|\d{1,9}[.)])(?: +|$)/;

// How deeply lists and quotes (counted together) are nested in a Markdown
// text. Read line by line, with no recursion, so a huge text cannot overflow
// the stack. A list is nested in another when it is indented further.
export function nestingLevels(markdown: string): number {
  let deepest = 0;
  // The indents of the list items above, each one nested in the one before.
  const open: number[] = [];
  for (const line of markdown.replace(/\t/g, '    ').split('\n')) {
    let rest = line;
    let marks = 0;
    let indent = -1;
    let match = LEADING_MARK.exec(rest);
    while (match) {
      if (indent < 0) {
        indent = match[1]!.length;
      }
      marks += 1;
      rest = rest.slice(match[0].length);
      match = LEADING_MARK.exec(rest);
    }
    if (marks === 0) {
      if (rest.trim() !== '' && !rest.startsWith(' ')) {
        open.length = 0;
      }
      continue;
    }
    while (open.length > 0 && open[open.length - 1]! >= indent) {
      open.pop();
    }
    deepest = Math.max(deepest, open.length + marks);
    open.push(indent);
  }
  return deepest;
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
