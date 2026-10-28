import type { BoardsService } from '../../src/boards/boards.service.js';
import type { CardsService } from '../../src/cards/cards.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { createProject, createUser } from './factories.js';

// Project WEB, owned by Ana, with one board (To do, In progress, Done) and
// two cards, WEB-1 and WEB-2, in To do. Ben is not a member.
export async function cardScenario(
  prisma: PrismaService,
  boards: BoardsService,
  cards: CardsService,
) {
  const ana = await createUser(prisma, 'ana');
  const ben = await createUser(prisma, 'ben');
  const project = await createProject(prisma, ana.id, 'Website', 'WEB');
  const board = await boards.createBoard(ana.id, project.id, {
    name: 'Sprint 1',
  });
  const [toDo, inProgress, done] = await prisma.column.findMany({
    where: { boardId: board.id },
    orderBy: { position: 'asc' },
  });
  const one = await cards.createCard(ana.id, toDo!.id, { title: 'Login' });
  const two = await cards.createCard(ana.id, toDo!.id, { title: 'Sign-up' });
  return {
    ana,
    ben,
    project,
    board,
    toDo: toDo!,
    inProgress: inProgress!,
    done: done!,
    one,
    two,
  };
}
