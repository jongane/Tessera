import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TimeEntry } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// How long a person may change their own time entry. After that only an
// admin can (docs/card-features.md, section 6).
const OWN_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// A time entry the user may change: their own for 24 hours, or any entry
// if they are a project admin. Non-members are told it is not found.
export async function findChangeableEntry(
  prisma: PrismaService,
  userId: string,
  entryId: string,
): Promise<TimeEntry> {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  const membership =
    entry &&
    (await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: entry.projectId, userId } },
    }));
  if (!entry || !membership) {
    throw new NotFoundException('Time entry not found');
  }
  if (membership.role === 'ADMIN') {
    return entry;
  }
  if (entry.userId !== userId) {
    throw new ForbiddenException(
      "Only a project admin can change someone else's time",
    );
  }
  if (Date.now() - entry.createdAt.getTime() > OWN_EDIT_WINDOW_MS) {
    throw new ForbiddenException(
      'Time can be changed for 24 hours after it is logged; after that, ask a project admin',
    );
  }
  return entry;
}
