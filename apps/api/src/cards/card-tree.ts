import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Card, Prisma } from '../generated/prisma/client.js';
import { takeNextCardNumber, takeNextSubtaskNumber } from './card-numbering.js';
import { lockUntilCovered } from './card-access.js';
import { cardRef, recordActivity } from '../activity/activity.js';

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

// The ids of every card above `cardId`: its parent, that card's parent,
// and so on to the top.
export async function loadAncestorIds(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT parent_id AS id FROM cards WHERE id = ${cardId}::uuid
      UNION ALL
      SELECT c.parent_id FROM cards c JOIN ancestors a ON c.id = a.id
    )
    SELECT id FROM ancestors WHERE id IS NOT NULL`;
  return rows.map((row) => row.id);
}

// Moves the card `cardId`, with everything below it, under `newParentId` (or
// to the top level when null). The moved cards get fresh numbers and their old
// numbers are kept, so references in chat still lead to them. Refuses a move
// under the card itself or one of its subtasks, and one deeper than 5 levels.
// The move is recorded in the history of every card it touches.
//
// Takes ids, not cards: everything is read again once the cards are locked
// (in id order, as a delete does, so the two never wait on each other), so a
// move that waited works from what the other change left.
export async function moveSubtree(
  tx: Prisma.TransactionClient,
  actorId: string,
  cardId: string,
  newParentId: string | null,
): Promise<Card> {
  let state!: MoveState;
  await lockUntilCovered(tx, async () => {
    state = await readMoveState(tx, cardId, newParentId);
    return [
      ...state.subtree.map((member) => member.id),
      ...(state.card.parentId ? [state.card.parentId] : []),
      ...(newParentId ? [newParentId] : []),
    ];
  });
  const { card, oldParent, newParent, subtree } = state;
  if (card.parentId === (newParent?.id ?? null)) {
    return card;
  }
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
    const numberPath =
      newPath + member.numberPath.slice(card.numberPath.length);
    await tx.card.update({
      where: { id: member.id },
      data: { numberPath, depth: member.depth - card.depth + newDepth },
    });
    await recordActivity(
      tx,
      { id: member.id, projectId: card.projectId },
      actorId,
      'NUMBER_CHANGED',
      { from: member.numberPath, to: numberPath },
    );
  }
  const moved = await tx.card.update({
    where: { id: card.id },
    data: {
      parentId: newParent?.id ?? null,
      numberPath: newPath,
      depth: newDepth,
    },
  });
  await recordMove(tx, actorId, card, moved, oldParent, newParent);
  return moved;
}

interface MoveState {
  card: Card;
  oldParent: Card | null;
  newParent: Card | null;
  subtree: TreeMember[];
}

export async function findCard(
  tx: Prisma.TransactionClient,
  cardId: string,
): Promise<Card> {
  const card = await tx.card.findUnique({ where: { id: cardId } });
  if (!card) {
    throw new NotFoundException('Card not found');
  }
  return card;
}

async function readMoveState(
  tx: Prisma.TransactionClient,
  cardId: string,
  newParentId: string | null,
): Promise<MoveState> {
  const card = await findCard(tx, cardId);
  return {
    card,
    oldParent: card.parentId ? await findCard(tx, card.parentId) : null,
    newParent: newParentId ? await findCard(tx, newParentId) : null,
    subtree: await loadSubtree(tx, cardId),
  };
}

async function recordMove(
  tx: Prisma.TransactionClient,
  actorId: string,
  before: Card,
  after: Card,
  oldParent: Card | null,
  newParent: Card | null,
): Promise<void> {
  await recordActivity(tx, after, actorId, 'PARENT_CHANGED', {
    from: oldParent && cardRef(oldParent),
    to: newParent && cardRef(newParent),
  });
  await recordActivity(tx, after, actorId, 'NUMBER_CHANGED', {
    from: before.numberPath,
    to: after.numberPath,
  });
  if (oldParent) {
    await recordActivity(tx, oldParent, actorId, 'SUBTASK_REMOVED', {
      subtask: cardRef(before),
      deleted: false,
    });
  }
  if (newParent) {
    await recordActivity(tx, newParent, actorId, 'SUBTASK_ADDED', {
      subtask: cardRef(after),
    });
  }
}
