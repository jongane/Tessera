import type { Prisma } from '../generated/prisma/client.js';

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
