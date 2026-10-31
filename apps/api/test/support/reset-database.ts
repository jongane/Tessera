import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Empties every table so each test starts from a clean database.
// CASCADE also clears rows that point at the deleted ones.
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sessions, failed_sign_ins, card_activity, checklist_items, checklists, card_labels, labels, card_assignees, running_timers, time_entries, card_number_aliases, chats, cards, columns, boards, project_codes, project_members, projects, users CASCADE',
  );
  // Server settings always keep their one row; put it back to the default.
  await prisma.serverSettings.update({
    where: { id: 1 },
    data: { signUpOpen: true },
  });
}
