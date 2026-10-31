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

// These tests write to the database directly, skipping the services, to prove
// the database itself refuses data that breaks the rules in docs/data-model.md.
// The services should never try, but if one has a bug the data stays correct.
// Each refusal names the constraint, so a test cannot pass for the wrong reason.
describe('Board, card and chat rules (database)', () => {
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
    return createBareCard(prisma, { boardId, columnId, title });
  }

  it('allows only one general chat per board', async () => {
    const { board } = await setUp();
    await prisma.chat.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });

    await expect(
      prisma.chat.create({
        data: { boardId: board.id, kind: 'GENERAL', title: 'General again' },
      }),
    ).rejects.toThrow('chats_one_general_per_board');
  });

  it('allows many topic chats on one board', async () => {
    const { board } = await setUp();

    await prisma.chat.create({
      data: { boardId: board.id, kind: 'TOPIC', title: 'Ideas' },
    });
    await prisma.chat.create({
      data: { boardId: board.id, kind: 'TOPIC', title: 'Release plan' },
    });

    await expect(
      prisma.chat.count({ where: { boardId: board.id } }),
    ).resolves.toBe(2);
  });

  it('refuses to link a general chat to a card', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);

    await expect(
      prisma.chat.create({
        data: {
          boardId: board.id,
          kind: 'GENERAL',
          title: 'General',
          cardId: card.id,
        },
      }),
    ).rejects.toThrow('chats_general_has_no_card');
  });

  it('allows at most one chat per card', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.chat.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await expect(
      prisma.chat.create({
        data: { boardId: board.id, title: 'Second chat', cardId: card.id },
      }),
    ).rejects.toThrow('chats_card_id_key');
  });

  it("refuses a card in another board's column", async () => {
    const { project, board } = await setUp();
    const other = await createBareBoard(prisma, project.id, 'Sprint 2');

    await expect(createCard(board.id, other.column.id)).rejects.toThrow(
      'cards_column_id_board_id_fkey',
    );
  });

  it("refuses to link a chat to another board's card", async () => {
    const { project, board } = await setUp();
    const other = await createBareBoard(prisma, project.id, 'Sprint 2');
    const otherCard = await createCard(other.board.id, other.column.id);

    await expect(
      prisma.chat.create({
        data: { boardId: board.id, title: 'Chat', cardId: otherCard.id },
      }),
    ).rejects.toThrow('chats_card_id_board_id_fkey');
  });

  it('refuses to delete a column that still has cards', async () => {
    const { board, column } = await setUp();
    await createCard(board.id, column.id);

    await expect(
      prisma.column.delete({ where: { id: column.id } }),
    ).rejects.toThrow('cards_column_id_board_id_fkey');
  });

  it('refuses to delete a card that still has a chat', async () => {
    // CardsService.deleteCard unlinks the chat first, so the chat is kept.
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.chat.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await expect(
      prisma.card.delete({ where: { id: card.id } }),
    ).rejects.toThrow('chats_card_id_board_id_fkey');
  });

  it('deletes columns, cards and chats with their board', async () => {
    const { board, column } = await setUp();
    const card = await createCard(board.id, column.id);
    await prisma.chat.create({
      data: { boardId: board.id, kind: 'GENERAL', title: 'General' },
    });
    await prisma.chat.create({
      data: { boardId: board.id, title: 'Login page', cardId: card.id },
    });

    await prisma.board.delete({ where: { id: board.id } });

    await expect(prisma.column.count()).resolves.toBe(0);
    await expect(prisma.card.count()).resolves.toBe(0);
    await expect(prisma.chat.count()).resolves.toBe(0);
  });

  it('deletes boards with their project', async () => {
    const { project } = await setUp();

    await prisma.project.delete({ where: { id: project.id } });

    await expect(prisma.board.count()).resolves.toBe(0);
  });
});
