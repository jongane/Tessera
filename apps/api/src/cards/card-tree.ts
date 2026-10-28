import { ConflictException } from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { takeNextCardNumber, takeNextSubtaskNumber } from './card-numbering.js';

// The deepest a card can be: 0 is top level, so 4 means 5 levels in all.
export const MAX_DEPTH = 4;

interface TreeMember {
  id: string;
  numberPath: string;
  depth: number;
}

// A card and every card below it, at every level.
export function loadSubtree(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<TreeMember[]> {
  return tx.$queryRaw<TreeMember[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, number_path, depth FROM cards WHERE id = ${cardId}::uuid
      UNION ALL
      SELECT c.id, c.number_path, c.depth
      FROM cards c JOIN subtree s ON c.parent_id = s.id
    )
    SELECT id, number_path AS "numberPath", depth FROM subtree`;
}

// Moves `card`, with everything below it, under `newParent` (or to the top
// level when null). The moved cards get fresh numbers and their old numbers
// are kept, so references in chat still lead to them. Refuses a move under
// the card itself or one of its subtasks, and one deeper than 5 levels.
export async function moveSubtree(
  tx: Prisma.TransactionClient,
  card: Card,
  newParent: Card | null,
): Promise<Card> {
  const subtree = await loadSubtree(tx, card.id);
  if (newParent && subtree.some((member) => member.id === newParent.id)) {
    throw new ConflictException(
      'A card cannot go under itself or one of its own subtasks',
    );
  }
  const newDepth = newParent ? newParent.depth + 1 : 0;
  const levelsBelow = Math.max(...subtree.map((m) => m.depth)) - card.depth;
  if (newDepth + levelsBelow > MAX_DEPTH) {
    throw new ConflictException(
      `Subtasks can only go ${MAX_DEPTH + 1} levels deep`,
    );
  }

  const newPath = newParent
    ? await takeNextSubtaskNumber(tx, newParent.id)
    : await takeNextCardNumber(tx, card.projectId);

  await tx.cardNumberAlias.createMany({
    data: subtree.map((member) => ({
      projectId: card.projectId,
      numberPath: member.numberPath,
      cardId: member.id,
    })),
  });
  for (const member of subtree.filter((m) => m.id !== card.id)) {
    await tx.card.update({
      where: { id: member.id },
      data: {
        numberPath: newPath + member.numberPath.slice(card.numberPath.length),
        depth: member.depth - card.depth + newDepth,
      },
    });
  }
  return tx.card.update({
    where: { id: card.id },
    data: {
      parentId: newParent?.id ?? null,
      numberPath: newPath,
      depth: newDepth,
    },
  });
}
