import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// Checklists (docs/card-features.md, section 2). Like subtask-rules.db-spec.ts,
// these write to the database directly to prove it refuses bad data. Each
// refusal names its constraint.
describe('Checklist rules (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    return { ana, project, card };
  }

  function checklist(
    card: { id: string; projectId: string },
    name = 'Testing',
  ) {
    return prisma.checklist.create({
      data: { cardId: card.id, projectId: card.projectId, name, position: 0 },
    });
  }

  function item(checklistId: string, text = 'Write tests') {
    return prisma.checklistItem.create({
      data: { checklistId, text, position: 0 },
    });
  }

  it('keeps a checklist in its card’s project', async () => {
    const { ana, card } = await setUp();
    const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');

    await expect(
      checklist({ id: card.id, projectId: mobile.id }),
    ).rejects.toThrow('checklists_card_id_project_id_fkey');
  });

  it('gives a checklist a name of 1 to 100 characters', async () => {
    const { card } = await setUp();

    await expect(checklist(card, 'x'.repeat(100))).resolves.toBeDefined();
    await expect(checklist(card, ' ')).rejects.toThrow(
      'checklists_name_length',
    );
    await expect(checklist(card, 'x'.repeat(101))).rejects.toThrow(
      'checklists_name_length',
    );
  });

  it('gives an item text of 1 to 500 characters, not ticked to start', async () => {
    const { card } = await setUp();
    const list = await checklist(card);

    await expect(item(list.id, 'x'.repeat(500))).resolves.toMatchObject({
      isDone: false,
    });
    await expect(item(list.id, '  ')).rejects.toThrow(
      'checklist_items_text_length',
    );
    await expect(item(list.id, 'x'.repeat(501))).rejects.toThrow(
      'checklist_items_text_length',
    );
  });

  it('deletes checklists and their items with the card', async () => {
    const { card } = await setUp();
    const list = await checklist(card);
    await item(list.id);

    await prisma.card.delete({ where: { id: card.id } });

    await expect(prisma.checklist.count()).resolves.toBe(0);
    await expect(prisma.checklistItem.count()).resolves.toBe(0);
  });
});
