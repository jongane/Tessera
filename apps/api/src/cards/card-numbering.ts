import type { Prisma } from '../generated/prisma/client.js';
import { reorder } from '../common/reorder.js';

// Helpers for numbering and placing cards. Each takes the transaction it
// runs in, so the number it takes is saved, or not, with the card.

// One past the highest position in the column, so the card lands at the bottom.
export async function nextPosition(
  tx: Prisma.TransactionClient,
  columnId: string,
): Promise<number> {
  const { _max } = await tx.card.aggregate({
    where: { columnId },
    _max: { position: true },
  });
  return (_max.position ?? -1) + 1;
}

// Locks the columns until the transaction ends, so cards moved into them at
// the same moment are placed one after the other. Always in id order, so two
// moves between the same columns can't wait on each other forever.
export async function lockColumns(
  tx: Prisma.TransactionClient,
  columnIds: string[],
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM columns WHERE id = ANY(${columnIds}::uuid[]) ORDER BY id FOR UPDATE`;
}

// Puts a card, already in the column, at `index` (0 is the top; past the end
// is the bottom), and numbers the column's cards from 0 again. Lock the
// column first (lockColumns).
export async function placeCardAt(
  tx: Prisma.TransactionClient,
  card: { id: string; columnId: string },
  index: number,
): Promise<void> {
  const cards = await tx.card.findMany({
    where: { columnId: card.columnId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, position: true },
  });
  const current = new Map(cards.map((row) => [row.id, row.position]));
  for (const [position, id] of reorder(cards, card.id, index)) {
    if (current.get(id) !== position) {
      await tx.card.update({ where: { id }, data: { position } });
    }
  }
}

// Takes the project's next card number and moves its counter on. The update
// locks the project's row until the transaction ends, so two cards created
// at the same moment can never get the same number.
export async function takeNextCardNumber(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<string> {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { nextCardNumber: { increment: 1 } },
    select: { nextCardNumber: true },
  });
  return String(project.nextCardNumber - 1);
}

// The number for a new subtask of `parentId` ("12.3"), taken from the
// parent's own counter in the same way.
export async function takeNextSubtaskNumber(
  tx: Prisma.TransactionClient,
  parentId: string,
): Promise<string> {
  const parent = await tx.card.update({
    where: { id: parentId },
    data: { nextSubtaskNumber: { increment: 1 } },
    select: { numberPath: true, nextSubtaskNumber: true },
  });
  return `${parent.numberPath}.${parent.nextSubtaskNumber - 1}`;
}
