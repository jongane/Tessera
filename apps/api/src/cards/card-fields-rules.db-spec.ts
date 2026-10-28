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

// Assignees, labels, priority, due dates and card creators
// (docs/card-features.md, sections 3, 8 and 10). Like subtask-rules.db-spec.ts,
// these write to the database directly to prove it refuses bad data. Each
// refusal names its constraint.
describe('Card field rules (database)', () => {
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

  // Project WEB with Ana (admin) and Cara (member). Ben is not a member.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const cara = await createUser(prisma, 'cara');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: cara.id },
    });
    const { board, column } = await createBareBoard(prisma, project.id);
    const card = await createBareCard(prisma, {
      boardId: board.id,
      columnId: column.id,
    });
    return { ana, ben, cara, project, board, column, card };
  }

  function assign(
    card: { id: string; projectId: string },
    userId: string,
    isOwner = false,
  ) {
    return prisma.cardAssignee.create({
      data: { cardId: card.id, projectId: card.projectId, userId, isOwner },
    });
  }

  describe('assignees', () => {
    it('only assigns members of the card’s project', async () => {
      const { ben, card } = await setUp();

      await expect(assign(card, ben.id)).rejects.toThrow(
        'card_assignees_project_id_user_id_fkey',
      );
    });

    it('assigns a person to a card only once', async () => {
      const { cara, card } = await setUp();
      await assign(card, cara.id);

      await expect(assign(card, cara.id)).rejects.toThrow('Unique constraint');
    });

    it('allows at most one owner per card', async () => {
      const { ana, cara, card } = await setUp();
      await assign(card, ana.id, true);

      await expect(assign(card, cara.id, true)).rejects.toThrow(
        'Unique constraint',
      );
      await expect(assign(card, cara.id, false)).resolves.toBeDefined();
    });

    it('removes a person’s assignments when they leave the project', async () => {
      const { cara, project, card } = await setUp();
      await assign(card, cara.id);

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: project.id, userId: cara.id } },
      });

      await expect(prisma.cardAssignee.count()).resolves.toBe(0);
    });

    it('removes assignments with their card', async () => {
      const { cara, card } = await setUp();
      await assign(card, cara.id);

      await prisma.card.delete({ where: { id: card.id } });

      await expect(prisma.cardAssignee.count()).resolves.toBe(0);
    });
  });

  describe('labels', () => {
    function label(projectId: string, name = 'Bug') {
      return prisma.label.create({
        data: { projectId, name, colour: 'RED' },
      });
    }

    it('keeps label names unique within a project', async () => {
      const { ana, project } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');
      await label(project.id);

      await expect(label(project.id)).rejects.toThrow('Unique constraint');
      await expect(label(mobile.id)).resolves.toBeDefined();
    });

    it('refuses an empty label name', async () => {
      const { project } = await setUp();

      await expect(label(project.id, '  ')).rejects.toThrow(
        'labels_name_not_blank',
      );
    });

    it('only puts a label on cards in its own project', async () => {
      const { ana, card } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');
      const mobileLabel = await label(mobile.id);

      await expect(
        prisma.cardLabel.create({
          data: {
            cardId: card.id,
            labelId: mobileLabel.id,
            projectId: card.projectId,
          },
        }),
      ).rejects.toThrow('card_labels_label_id_project_id_fkey');
    });

    it('takes a deleted label off its cards', async () => {
      const { project, card } = await setUp();
      const bug = await label(project.id);
      await prisma.cardLabel.create({
        data: { cardId: card.id, labelId: bug.id, projectId: project.id },
      });

      await prisma.label.delete({ where: { id: bug.id } });

      await expect(prisma.cardLabel.count()).resolves.toBe(0);
    });
  });

  describe('priority, due dates and creators', () => {
    it('gives new cards no priority', async () => {
      const { card } = await setUp();

      expect(card.priority).toBe('NONE');
    });

    it('keeps a due date without a time at midnight UTC', async () => {
      const { card } = await setUp();
      const update = (dueAt: Date, dueHasTime: boolean) =>
        prisma.card.update({
          where: { id: card.id },
          data: { dueAt, dueHasTime },
        });

      await expect(
        update(new Date('2026-11-01T00:00:00Z'), false),
      ).resolves.toBeDefined();
      await expect(
        update(new Date('2026-11-01T17:30:00Z'), true),
      ).resolves.toBeDefined();
      await expect(
        update(new Date('2026-11-01T17:30:00Z'), false),
      ).rejects.toThrow('cards_due_date_only_at_midnight');
    });

    it('has no due time without a due date', async () => {
      const { card } = await setUp();

      await expect(
        prisma.card.update({
          where: { id: card.id },
          data: { dueAt: null, dueHasTime: true },
        }),
      ).rejects.toThrow('cards_due_time_needs_date');
    });

    it('keeps a card when its creator is deleted', async () => {
      const { ben, board, column } = await setUp();
      const card = await prisma.card.update({
        where: {
          id: (
            await createBareCard(prisma, {
              boardId: board.id,
              columnId: column.id,
            })
          ).id,
        },
        data: { createdById: ben.id },
      });

      await prisma.user.delete({ where: { id: ben.id } });

      await expect(
        prisma.card.findUnique({ where: { id: card.id } }),
      ).resolves.toMatchObject({ createdById: null });
    });
  });
});
