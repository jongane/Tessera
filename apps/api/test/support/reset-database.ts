import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Empties every table so each test starts from a clean database.
// CASCADE also clears rows that point at the deleted ones.
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE card_number_aliases, threads, cards, columns, boards, project_codes, project_members, projects, users CASCADE',
  );
}
