import { z } from 'zod';
import { textWithoutNul } from './text.js';

export const activityQuerySchema = z.strictObject({
  // 1 to 100 lines per page; 50 when left out.
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // The `nextBefore` of the previous page.
  before: textWithoutNul().max(20).optional(),
});

export type ActivityQuery = z.infer<typeof activityQuerySchema>;
