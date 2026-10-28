import type { PrismaService } from '../prisma/prisma.service.js';

// One card in a tree, with its own estimate and the time logged on it.
export interface TreeTimes {
  id: string;
  parentId: string | null;
  estimateMinutes: number | null;
  loggedMinutes: number;
}

export interface CardTotals {
  // The card's own estimate, or for a card with subtasks the sum of theirs,
  // at every level. Null when nothing has an estimate.
  estimateMinutes: number | null;
  // A card with subtasks keeps its own estimate, shown greyed out. Null for
  // a card without subtasks, whose own estimate is estimateMinutes.
  originalEstimateMinutes: number | null;
  // Time on the card itself plus all its subtasks, at every level.
  timeSpentMinutes: number;
  ownTimeMinutes: number;
}

// Works out the totals for `rootId` from its tree (docs/card-features.md,
// section 6). Totals are worked out when read, never stored, so they cannot
// go out of date.
export function rollUp(cards: TreeTimes[], rootId: string): CardTotals {
  const children = new Map<string, TreeTimes[]>();
  for (const card of cards) {
    if (card.parentId) {
      children.set(card.parentId, [
        ...(children.get(card.parentId) ?? []),
        card,
      ]);
    }
  }

  function totalsOf(card: TreeTimes): CardTotals {
    const subtasks = (children.get(card.id) ?? []).map(totalsOf);
    if (subtasks.length === 0) {
      return {
        estimateMinutes: card.estimateMinutes,
        originalEstimateMinutes: null,
        timeSpentMinutes: card.loggedMinutes,
        ownTimeMinutes: card.loggedMinutes,
      };
    }
    const estimates = subtasks
      .map((subtask) => subtask.estimateMinutes)
      .filter((minutes) => minutes !== null);
    return {
      estimateMinutes:
        estimates.length > 0 ? estimates.reduce((a, b) => a + b, 0) : null,
      originalEstimateMinutes: card.estimateMinutes,
      timeSpentMinutes:
        card.loggedMinutes +
        subtasks.reduce((sum, subtask) => sum + subtask.timeSpentMinutes, 0),
      ownTimeMinutes: card.loggedMinutes,
    };
  }

  const root = cards.find((card) => card.id === rootId);
  if (!root) {
    throw new Error(`Card ${rootId} is not in the tree`);
  }
  return totalsOf(root);
}

// The card and every card below it, each with its estimate and logged time.
export function loadTreeTimes(
  prisma: PrismaService,
  cardId: string,
): Promise<TreeTimes[]> {
  return prisma.$queryRaw<TreeTimes[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, parent_id, estimate_minutes FROM cards WHERE id = ${cardId}::uuid
      UNION ALL
      SELECT c.id, c.parent_id, c.estimate_minutes
      FROM cards c JOIN subtree s ON c.parent_id = s.id
    )
    SELECT s.id, s.parent_id AS "parentId",
           s.estimate_minutes AS "estimateMinutes",
           COALESCE(SUM(t.minutes), 0)::int AS "loggedMinutes"
    FROM subtree s LEFT JOIN time_entries t ON t.card_id = s.id
    GROUP BY s.id, s.parent_id, s.estimate_minutes`;
}
