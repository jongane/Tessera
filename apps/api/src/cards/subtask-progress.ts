import type { Prisma } from '../generated/prisma/client.js';

// "3 of 5 complete": counts direct subtasks only (docs/card-features.md,
// section 4).
export interface SubtaskProgress {
  complete: number;
  total: number;
}

// Add to a card query's include to read what subtaskProgressOf needs.
export const directSubtaskCompletion = {
  subtasks: { select: { isComplete: true } },
} satisfies Prisma.CardInclude;

export function subtaskProgressOf(
  subtasks: { isComplete: boolean }[],
): SubtaskProgress {
  return {
    complete: subtasks.filter((subtask) => subtask.isComplete).length,
    total: subtasks.length,
  };
}
