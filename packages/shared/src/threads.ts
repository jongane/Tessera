import { z } from 'zod';

export const newThreadSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const threadLinkSchema = z.strictObject({
  cardId: z.uuid(),
});

export type NewThreadBody = z.infer<typeof newThreadSchema>;
export type ThreadLink = z.infer<typeof threadLinkSchema>;
