import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createBareCard,
  createBareSubtask,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// Subtasks, old card numbers and done columns (docs/card-features.md,
// sections 1, 4 and 5). Like board-rules.db-spec.ts, these write to the
// database directly to prove it refuses bad data. Each refusal names its
// constraint.
describe('Subtask rules (database)', () => {
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
    return { ana, project, board, column, card };
  }

  it('allows subtasks down to 5 levels and no deeper', async () => {
    const { card } = await setUp();
    let level = card;
    for (let depth = 1; depth <= 4; depth++) {
      level = await createBareSubtask(prisma, level);
    }
    expect(level).toMatchObject({ depth: 4, numberPath: '1.1.1.1.1' });

    await expect(createBareSubtask(prisma, level)).rejects.toThrow(
      'cards_depth_range',
    );
  });

  it('gives a card with no parent depth 0, and a subtask depth 1 or more', async () => {
    const { project, board, column, card } = await setUp();

    await expect(
      prisma.card.update({ where: { id: card.id }, data: { depth: 1 } }),
    ).rejects.toThrow('cards_parent_matches_depth');
    await expect(
      prisma.card.create({
        data: {
          projectId: project.id,
          boardId: board.id,
          columnId: column.id,
          parentId: card.id,
          depth: 0,
          title: 'Subtask',
          numberPath: '1.1',
          position: 0,
        },
      }),
    ).rejects.toThrow('cards_parent_matches_depth');
  });

  it('refuses a card that is its own parent', async () => {
    const { card } = await setUp();

    await expect(
      prisma.card.update({
        where: { id: card.id },
        data: { parentId: card.id, depth: 1 },
      }),
    ).rejects.toThrow('cards_not_own_parent');
  });

  it('allows a subtask on another board of the same project', async () => {
    const { project, card } = await setUp();
    const other = await createBareBoard(prisma, project.id, 'Design');

    const subtask = await prisma.card.create({
      data: {
        projectId: project.id,
        boardId: other.board.id,
        columnId: other.column.id,
        parentId: card.id,
        depth: 1,
        title: 'Logo',
        numberPath: '1.1',
        position: 0,
      },
    });

    expect(subtask.boardId).toBe(other.board.id);
  });

  it('refuses a parent in another project', async () => {
    const { ana, card } = await setUp();
    const mobile = await createProject(prisma, ana.id, 'Mobile app', 'MOB');
    const other = await createBareBoard(prisma, mobile.id);

    await expect(
      prisma.card.create({
        data: {
          projectId: mobile.id,
          boardId: other.board.id,
          columnId: other.column.id,
          parentId: card.id,
          depth: 1,
          title: 'Subtask',
          numberPath: '1.1',
          position: 0,
        },
      }),
    ).rejects.toThrow('cards_parent_id_project_id_fkey');
  });

  it('refuses to delete a card that still has subtasks', async () => {
    // CardsService.deleteCard asks what to do with each subtask first.
    const { card } = await setUp();
    await createBareSubtask(prisma, card);

    await expect(
      prisma.card.delete({ where: { id: card.id } }),
    ).rejects.toThrow('cards_parent_id_project_id_fkey');
  });

  describe('old card numbers', () => {
    it('refuses the same old number twice in a project', async () => {
      const { project, card } = await setUp();
      await prisma.cardNumberAlias.create({
        data: { projectId: project.id, numberPath: '7', cardId: card.id },
      });

      await expect(
        prisma.cardNumberAlias.create({
          data: { projectId: project.id, numberPath: '7', cardId: card.id },
        }),
      ).rejects.toThrow('card_number_aliases_pkey');
    });

    it('refuses an old number that points at a card in another project', async () => {
      const { ana, card } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile app', 'MOB');

      await expect(
        prisma.cardNumberAlias.create({
          data: { projectId: mobile.id, numberPath: '7', cardId: card.id },
        }),
      ).rejects.toThrow('card_number_aliases_card_id_project_id_fkey');
    });

    it('refuses a badly formed old number', async () => {
      const { project, card } = await setUp();

      await expect(
        prisma.cardNumberAlias.create({
          data: { projectId: project.id, numberPath: '7.', cardId: card.id },
        }),
      ).rejects.toThrow('card_number_aliases_number_path_format');
    });

    it("deletes a card's old numbers with the card", async () => {
      const { project, card } = await setUp();
      await prisma.cardNumberAlias.create({
        data: { projectId: project.id, numberPath: '7', cardId: card.id },
      });

      await prisma.card.delete({ where: { id: card.id } });

      await expect(prisma.cardNumberAlias.count()).resolves.toBe(0);
    });
  });

  describe('completion', () => {
    it('starts cards not complete, and columns not done', async () => {
      const { card, column } = await setUp();

      expect(card).toMatchObject({ isComplete: false, completedAt: null });
      expect(column.isDone).toBe(false);
    });

    it('refuses a completion time on a card that is not complete', async () => {
      const { card } = await setUp();

      await expect(
        prisma.card.update({
          where: { id: card.id },
          data: { completedAt: new Date() },
        }),
      ).rejects.toThrow('cards_completed_at_matches');
      await expect(
        prisma.card.update({
          where: { id: card.id },
          data: { isComplete: true },
        }),
      ).rejects.toThrow('cards_completed_at_matches');
    });
  });
});
