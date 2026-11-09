import { z } from 'zod';
import { textWithoutNul } from './text.js';

// The text of a chat message, as Markdown. Used when a message is sent and
// when it is edited.
export const MESSAGE_BODY_MAX = 10_000;

export const messageBodySchema = textWithoutNul()
  .trim()
  .min(1)
  .max(MESSAGE_BODY_MAX, `Use at most ${MESSAGE_BODY_MAX} characters`);

export const messageBodyRequestSchema = z.strictObject({
  body: messageBodySchema,
});

export type MessageBodyRequest = z.infer<typeof messageBodyRequestSchema>;
