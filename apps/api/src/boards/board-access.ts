import type { Prisma } from '../generated/prisma/client.js';

// The boards a user may see: those in projects they are a member of.
// Every board, column, card and chat query filters through this,
// so a user can never reach another project's data.
export function boardsVisibleTo(userId: string): Prisma.BoardWhereInput {
  return { project: { members: { some: { userId } } } };
}
