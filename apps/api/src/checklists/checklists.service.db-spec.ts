import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { SubtasksService } from '../cards/subtasks.service.js';
import { ChecklistsService } from './checklists.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// docs/card-features.md, section 2.
describe('ChecklistsService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;
  let checklists: ChecklistsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        CardsService,
        SubtasksService,
        ChecklistsService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
    checklists = moduleRef.get(ChecklistsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setUp = () => cardScenario(prisma, boards, cards);

  // WEB-1 with a "Testing" checklist of three items: A, B and C.
  async function setUpWithList() {
    const setup = await setUp();
    const list = await checklists.createChecklist(
      setup.ana.id,
      setup.one.id,
      'Testing',
    );
    const items = [];
    for (const text of ['A', 'B', 'C']) {
      items.push(await checklists.addItem(setup.ana.id, list.id, text));
    }
    return { ...setup, list, a: items[0]!, b: items[1]!, c: items[2]! };
  }

  async function itemTexts(userId: string, cardId: string) {
    const lists = await checklists.listChecklists(userId, cardId);
    return lists.map(
      (l) => `${l.name}: ${l.items.map((i) => i.text).join('')}`,
    );
  }

  describe('checklists', () => {
    it('gives a card several named checklists, in the order made', async () => {
      const { ana, one } = await setUp();

      await checklists.createChecklist(ana.id, one.id, ' Testing ');
      await checklists.createChecklist(ana.id, one.id, 'Release');

      const lists = await checklists.listChecklists(ana.id, one.id);
      expect(lists.map((l) => l.name)).toEqual(['Testing', 'Release']);
    });

    it('renames, reorders and deletes a checklist', async () => {
      const { ana, one, list } = await setUpWithList();
      const release = await checklists.createChecklist(
        ana.id,
        one.id,
        'Release',
      );

      await checklists.renameChecklist(ana.id, list.id, 'QA');
      await checklists.moveChecklist(ana.id, release.id, 0);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Release: ', 'QA: ABC']);

      await checklists.deleteChecklist(ana.id, list.id);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Release: ']);
      await expect(prisma.checklistItem.count()).resolves.toBe(0);
    });

    it('suggests a new card once a card has more than 10 checklists', async () => {
      const { ana, one } = await setUp();
      const made = [];
      for (let i = 1; i <= 11; i++) {
        made.push(
          await checklists.createChecklist(ana.id, one.id, `List ${i}`),
        );
      }

      expect(made[9]!.suggestNewCard).toBe(false);
      expect(made[10]!.suggestNewCard).toBe(true);
    });

    it('refuses a blank or very long name', async () => {
      const { ana, one } = await setUp();

      await expect(
        checklists.createChecklist(ana.id, one.id, '  '),
      ).rejects.toThrow(BadRequestException);
      await expect(
        checklists.createChecklist(ana.id, one.id, 'x'.repeat(101)),
      ).rejects.toThrow(BadRequestException);
    });

    it('shows each checklist’s own progress', async () => {
      const { ana, one, list, a, c } = await setUpWithList();
      await checklists.createChecklist(ana.id, one.id, 'Release');
      await checklists.updateItem(ana.id, a.id, { isDone: true });
      await checklists.updateItem(ana.id, c.id, { isDone: true });

      const lists = await checklists.listChecklists(ana.id, one.id);

      expect(lists.map((l) => [l.id === list.id, l.progress])).toEqual([
        [true, { done: 2, total: 3 }],
        [false, { done: 0, total: 0 }],
      ]);
    });
  });

  describe('items', () => {
    it('edits and ticks an item', async () => {
      const { ana, b } = await setUpWithList();

      await expect(
        checklists.updateItem(ana.id, b.id, { text: ' Bee ', isDone: true }),
      ).resolves.toMatchObject({ text: 'Bee', isDone: true });
    });

    it('moves an item up or down the list', async () => {
      const { ana, one, a, c } = await setUpWithList();

      await checklists.moveItem(ana.id, c.id, 0);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Testing: CAB']);

      await checklists.moveItem(ana.id, c.id, 99);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Testing: ABC']);

      await checklists.moveItem(ana.id, a.id, 1);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Testing: BAC']);
    });

    it('refuses a negative or fractional position', async () => {
      const { ana, a } = await setUpWithList();

      await expect(checklists.moveItem(ana.id, a.id, -1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(checklists.moveItem(ana.id, a.id, 1.5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes an item', async () => {
      const { ana, one, b } = await setUpWithList();

      await checklists.deleteItem(ana.id, b.id);

      expect(await itemTexts(ana.id, one.id)).toEqual(['Testing: AC']);
    });

    it('refuses blank or very long text', async () => {
      const { ana, list, a } = await setUpWithList();

      await expect(checklists.addItem(ana.id, list.id, ' ')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        checklists.updateItem(ana.id, a.id, { text: 'x'.repeat(501) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows at most 100 items in a checklist', async () => {
      const { ana, list } = await setUpWithList();
      await prisma.checklistItem.createMany({
        data: Array.from({ length: 97 }, (_, i) => ({
          checklistId: list.id,
          text: `Item ${i}`,
          position: 10 + i,
        })),
      });

      await expect(
        checklists.addItem(ana.id, list.id, 'One too many'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('turnItemIntoSubtask', () => {
    it('replaces the item with an unassigned subtask in the card’s column', async () => {
      const { ana, one, toDo, b } = await setUpWithList();

      const subtask = await checklists.turnItemIntoSubtask(ana.id, b.id);

      expect(subtask).toMatchObject({
        title: 'B',
        parentId: one.id,
        columnId: toDo.id,
        numberPath: '1.1',
      });
      await expect(
        prisma.cardAssignee.count({ where: { cardId: subtask.id } }),
      ).resolves.toBe(0);
      expect(await itemTexts(ana.id, one.id)).toEqual(['Testing: AC']);
    });

    it('keeps the item when the card is already 5 levels deep', async () => {
      const { ana, one, toDo } = await setUp();
      let deepest = one;
      for (let depth = 1; depth <= 4; depth++) {
        deepest = await subtasks.createSubtask(ana.id, deepest.id, toDo.id, {
          title: `Level ${depth}`,
        });
      }
      const list = await checklists.createChecklist(
        ana.id,
        deepest.id,
        'Steps',
      );
      const step = await checklists.addItem(ana.id, list.id, 'Too deep');

      await expect(
        checklists.turnItemIntoSubtask(ana.id, step.id),
      ).rejects.toThrow(ConflictException);
      await expect(
        prisma.checklistItem.count({ where: { id: step.id } }),
      ).resolves.toBe(1);
    });
  });

  it('refuses someone who is not a member of the project', async () => {
    const { ben, one, list, a } = await setUpWithList();

    await expect(
      checklists.createChecklist(ben.id, one.id, 'Mine'),
    ).rejects.toThrow(NotFoundException);
    await expect(checklists.listChecklists(ben.id, one.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(checklists.addItem(ben.id, list.id, 'D')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      checklists.updateItem(ben.id, a.id, { isDone: true }),
    ).rejects.toThrow(NotFoundException);
    await expect(checklists.turnItemIntoSubtask(ben.id, a.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(checklists.deleteChecklist(ben.id, list.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
