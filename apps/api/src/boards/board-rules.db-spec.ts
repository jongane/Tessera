import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import {
  createBareBoard,
  createProject,
  createUser,
} from '../../test/support/factories.js';

// These tests write to the database directly, skipping the services, to prove
// the database itself refuses data that breaks the rules in docs/data-model.md.
// The services should never try, but if one has a bug the data stays correct.
// Each refusal names the constraint, so a test cannot pass for the wrong reason.
describe('Board, card and thread rules (database)', () => {
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
    const project = await createProject(prisma, ana.id);
    const { board, column } = await createBareBoard(prisma, project.id);
    return { project, board, column };
  }

  function createCard(boardId: string, columnId: string, title = 'Login page') {
    return prisma.card.create({
      data: { boardId, columnId, title, position: 0 },
    });
  }

  it('allows only one general thread per board', async () => {
    const { board } = await setUp();
    await prisma.thread.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });

    await expect(
      prisma.thread.create({
        data: { boardId: board.id, kind: 'GENERAL', title: 'General again' },
      }),
    ).rejects.toThrow('threads_one_general_per_board');
  });

  it('allows many topic threads on one board', async () => {
    const { board } = await setUp();

    await prisma.thread.create({
      data: { boardId: board.id, kind: 'TOPIC', title: 'Ideas' },
    });
    await prisma.thread.create({
      data: { boardId: board.id, kind: 'TOPIC', title: 'Release plan' },
    });

    await expect(
      prisma.thread.count({ where: { boardId: board.id } }),
    ).resolves.toBe(2);
  });

  it('refuses to link a general thread to a card', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);

    await expect(
      prisma.thread.create({
        data: {
          boardId: board.id,
          kind: 'GENERAL',
          title: 'General',
          cardId: card.id,
        },
      }),
    ).rejects.toThrow('threads_general_has_no_card');
  });

  it('allows at most one thread per card', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.thread.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await expect(
      prisma.thread.create({
        data: { boardId: board.id, title: 'Second chat', cardId: card.id },
      }),
    ).rejects.toThrow('threads_card_id_key');
  });

  it("refuses a card in another board's column", async () => {
    const { project, board } = await setUp();
    const other = await createBareBoard(prisma, project.id, 'Sprint 2');

    await expect(createCard(board.id, other.column.id)).rejects.toThrow(
      'cards_column_id_board_id_fkey',
    );
  });

  it("refuses to link a thread to another board's card", async () => {
    const { project, board } = await setUp();
    const other = await createBareBoard(prisma, project.id, 'Sprint 2');
    const otherCard = await createCard(other.board.id, other.column.id);

    await expect(
      prisma.thread.create({
        data: { boardId: board.id, title: 'Chat', cardId: otherCard.id },
      }),
    ).rejects.toThrow('threads_card_id_board_id_fkey');
  });

  it('refuses to delete a column that still has cards', async () => {
    const { board, column } = await setUp();
    await createCard(board.id, column.id);

    await expect(
      prisma.column.delete({ where: { id: column.id } }),
    ).rejects.toThrow('cards_column_id_board_id_fkey');
  });

  it('refuses to delete a card that still has a thread', async () => {
    // CardsService.deleteCard unlinks the thread first, so the chat is kept.
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.thread.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await expect(
      prisma.card.delete({ where: { id: card.id } }),
    ).rejects.toThrow('threads_card_id_board_id_fkey');
  });

  it('deletes columns, cards and threads with their board', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.thread.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });
    await prisma.thread.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await prisma.board.delete({ where: { id: board.id } });

    await expect(prisma.column.count()).resolves.toBe(0);
    await expect(prisma.card.count()).resolves.toBe(0);
    await expect(prisma.thread.count()).resolves.toBe(0);
  });

  it('deletes boards with their project', async () => {
    const { project } = await setUp();

    await prisma.project.delete({ where: { id: project.id } });

    await expect(prisma.board.count()).resolves.toBe(0);
  });

  it('keeps a card but clears its assignee when the user is deleted', async () => {
    const { board, column } = await setUp();
    const ben = await createUser(prisma, 'ben');
    const card = await prisma.card.create({
      data: {
        boardId: board.id,
        columnId: column.id,
        title: 'Login page',
        position: 0,
        assigneeId: ben.id,
      },
    });

    await prisma.user.delete({ where: { id: ben.id } });

    await expect(
      prisma.card.findUnique({ where: { id: card.id } }),
    ).resolves.toMatchObject({ assigneeId: null });
  });
});
