import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';

// Deleting a card that has subtasks: docs/card-features.md, section 4.
describe('Deleting a parent card (database)', () => {
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

  // WEB-1 with three subtasks (WEB-1.1 to WEB-1.3), and WEB-2.
  async function setUp() {
    const scenario = await cardScenario(prisma, boards, cards);
    const { ana, one, toDo } = scenario;
    const created = [];
    for (const title of ['Form', 'Errors', 'Emails']) {
      created.push(
        await subtasks.createSubtask(ana.id, one.id, toDo.id, { title }),
      );
    }
    return {
      ...scenario,
      form: created[0]!,
      errors: created[1]!,
      emails: created[2]!,
    };
  }

  function find(cardId: string) {
    return prisma.card.findUnique({ where: { id: cardId } });
  }

  it('needs a choice for every direct subtask', async () => {
    const { ana, one, form } = await setUp();

    await expect(
      cards.deleteCard(ana.id, one.id, { [form.id]: { action: 'delete' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(find(one.id)).resolves.not.toBeNull();
  });

  it('deletes, frees or moves each subtask as chosen, then deletes the card', async () => {
    const { ana, one, two, form, errors, emails } = await setUp();
    const formThread = await prisma.thread.findUniqueOrThrow({
      where: { cardId: form.id },
    });

    await cards.deleteCard(ana.id, one.id, {
      [form.id]: { action: 'delete' },
      [errors.id]: { action: 'standalone' },
      [emails.id]: { action: 'move', parentId: two.id },
    });

    await expect(find(one.id)).resolves.toBeNull();
    await expect(find(form.id)).resolves.toBeNull();
    await expect(find(errors.id)).resolves.toMatchObject({
      parentId: null,
      numberPath: '3',
    });
    await expect(find(emails.id)).resolves.toMatchObject({
      parentId: two.id,
      numberPath: '2.1',
    });
    // Chats are kept, as when any card is deleted.
    await expect(
      prisma.thread.findUnique({ where: { id: formThread.id } }),
    ).resolves.toMatchObject({ cardId: null });
  });

  it('refuses to delete a subtask that has its own subtasks', async () => {
    const { ana, one, form, errors, emails, toDo } = await setUp();
    await subtasks.createSubtask(ana.id, form.id, toDo.id, {
      title: 'Validation',
    });

    await expect(
      cards.deleteCard(ana.id, one.id, {
        [form.id]: { action: 'delete' },
        [errors.id]: { action: 'standalone' },
        [emails.id]: { action: 'standalone' },
      }),
    ).rejects.toThrow(ConflictException);
    await expect(find(one.id)).resolves.not.toBeNull();
    await expect(find(errors.id)).resolves.toMatchObject({ parentId: one.id });
  });

  it('refuses to move a subtask under a card that is being deleted', async () => {
    const { ana, one, form, errors, emails } = await setUp();

    await expect(
      cards.deleteCard(ana.id, one.id, {
        [form.id]: { action: 'move', parentId: errors.id },
        [errors.id]: { action: 'delete' },
        [emails.id]: { action: 'standalone' },
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(find(one.id)).resolves.not.toBeNull();
  });
});
