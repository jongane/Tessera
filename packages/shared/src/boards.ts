import { z } from 'zod';

export const newBoardSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});

export const columnChangesSchema = z.strictObject({
  isDone: z.boolean(),
});

export type NewBoardBody = z.infer<typeof newBoardSchema>;
export type ColumnChanges = z.infer<typeof columnChangesSchema>;
