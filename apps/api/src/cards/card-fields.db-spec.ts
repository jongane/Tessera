import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createUser } from '../../test/support/factories.js';

// Priority, due dates and who may delete a card: docs/card-features.md,
// sections 8 and 10.
describe('Card fields (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, SubtasksService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Ana is the admin, Cara and Dev ordinary members, Ben not a member.
  async function setUp() {
    const scenario = await cardScenario(prisma, boards, cards);
    const cara = await createUser(prisma, 'cara');
    const dev = await createUser(prisma, 'dev');
    await prisma.projectMember.createMany({
      data: [cara, dev].map((user) => ({
        projectId: scenario.project.id,
        userId: user.id,
      })),
    });
    return { ...scenario, cara, dev };
  }

  describe('setPriority', () => {
    it('sets a card’s priority', async () => {
      const { cara, one } = await setUp();

      await expect(
        cards.setPriority(cara.id, one.id, 'URGENT'),
      ).resolves.toMatchObject({ priority: 'URGENT' });
    });

    it('refuses a priority not in the list, and non-members', async () => {
      const { ben, cara, one } = await setUp();

      await expect(
        cards.setPriority(cara.id, one.id, 'CRITICAL'),
      ).rejects.toThrow(BadRequestException);
      await expect(cards.setPriority(ben.id, one.id, 'LOW')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setDueDate', () => {
    it('sets a day, a day and time, or nothing', async () => {
      const { cara, one } = await setUp();

      await expect(
        cards.setDueDate(cara.id, one.id, { date: '2026-11-01' }),
      ).resolves.toMatchObject({
        dueAt: new Date('2026-11-01T00:00:00Z'),
        dueHasTime: false,
      });
      await expect(
        cards.setDueDate(cara.id, one.id, { at: '2026-11-01T17:30:00Z' }),
      ).resolves.toMatchObject({
        dueAt: new Date('2026-11-01T17:30:00Z'),
        dueHasTime: true,
      });
      await expect(
        cards.setDueDate(cara.id, one.id, null),
      ).resolves.toMatchObject({ dueAt: null, dueHasTime: false });
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(
        cards.setDueDate(ben.id, one.id, { date: '2026-11-01' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('dueDateWarnings', () => {
    it('warns on both cards when a subtask is due after its parent', async () => {
      const { ana, one, toDo } = await setUp();
      const early = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Early',
      });
      const late = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Late',
      });
      await cards.setDueDate(ana.id, one.id, { date: '2026-11-10' });
      await cards.setDueDate(ana.id, early.id, { date: '2026-11-05' });
      await cards.setDueDate(ana.id, late.id, { date: '2026-11-12' });

      await expect(subtasks.dueDateWarnings(ana.id, one.id)).resolves.toEqual({
        dueAfterParent: false,
        subtasksDueAfter: [late.id],
      });
      await expect(subtasks.dueDateWarnings(ana.id, late.id)).resolves.toEqual({
        dueAfterParent: true,
        subtasksDueAfter: [],
      });
      await expect(subtasks.dueDateWarnings(ana.id, early.id)).resolves.toEqual(
        { dueAfterParent: false, subtasksDueAfter: [] },
      );
    });

    it('shows nothing to someone who is not a member', async () => {
      const { ben, one } = await setUp();

      await expect(subtasks.dueDateWarnings(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('who may delete a card', () => {
    it('records who created each card and subtask', async () => {
      const { cara, one, toDo } = await setUp();

      const card = await cards.createCard(cara.id, toDo.id, { title: 'Mine' });
      const subtask = await subtasks.createSubtask(cara.id, one.id, toDo.id, {
        title: 'Also mine',
      });

      expect(card.createdById).toBe(cara.id);
      expect(subtask.createdById).toBe(cara.id);
    });

    it('lets the person who created a card delete it', async () => {
      const { cara, toDo } = await setUp();
      const card = await cards.createCard(cara.id, toDo.id, { title: 'Mine' });

      await cards.deleteCard(cara.id, card.id);

      await expect(prisma.card.count({ where: { id: card.id } })).resolves.toBe(
        0,
      );
    });

    it('lets an admin delete anyone’s card', async () => {
      const { ana, cara, toDo } = await setUp();
      const card = await cards.createCard(cara.id, toDo.id, {
        title: 'Cara’s',
      });

      await cards.deleteCard(ana.id, card.id);

      await expect(prisma.card.count({ where: { id: card.id } })).resolves.toBe(
        0,
      );
    });

    it('refuses another member', async () => {
      const { cara, dev, toDo } = await setUp();
      const card = await cards.createCard(cara.id, toDo.id, {
        title: 'Cara’s',
      });

      await expect(cards.deleteCard(dev.id, card.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('leaves a card with no recorded creator to admins', async () => {
      const { cara, one } = await setUp();
      await prisma.card.update({
        where: { id: one.id },
        data: { createdById: null },
      });

      await expect(cards.deleteCard(cara.id, one.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('needs the same right to delete subtasks along with their parent', async () => {
      const { cara, dev, one, toDo } = await setUp();
      const mine = await cards.createCard(dev.id, toDo.id, { title: 'Dev’s' });
      const caras = await subtasks.createSubtask(cara.id, mine.id, toDo.id, {
        title: 'Cara’s subtask',
      });

      await expect(
        cards.deleteCard(dev.id, mine.id, { [caras.id]: { action: 'delete' } }),
      ).rejects.toThrow(ForbiddenException);
      await cards.deleteCard(dev.id, mine.id, {
        [caras.id]: { action: 'standalone' },
      });
      await expect(
        prisma.card.count({ where: { id: { in: [one.id, caras.id] } } }),
      ).resolves.toBe(2);
    });
  });
});
