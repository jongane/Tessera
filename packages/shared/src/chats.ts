import { z } from 'zod';
import { textWithoutNul } from './text.js';

export const newChatSchema = z.strictObject({
  title: textWithoutNul().trim().min(1).max(200),
});

export const chatLinkSchema = z.strictObject({
  cardId: z.uuid(),
});

export type NewChatBody = z.infer<typeof newChatSchema>;
export type ChatLink = z.infer<typeof chatLinkSchema>;
