import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { ChatsService } from './chats.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createProject, createUser } from '../../test/support/factories.js';

describe('ChatsService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let chats: ChatsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, ChatsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    chats = moduleRef.get(ChatsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // A project owned by Ana with one board. Ben is not a member.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const project = await createProject(prisma, ana.id);
    const board = await boards.createBoard(ana.id, project.id, {
      name: 'Sprint 1',
    });
    const toDo = await prisma.column.findFirstOrThrow({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return { ana, ben, project, board, toDo };
  }

  // A card whose own chat has been unlinked, so it has none.
  async function cardWithoutChat(userId: string, columnId: string) {
    const card = await cards.createCard(userId, columnId, {
      title: 'Login page',
    });
    await prisma.chat.update({
      where: { cardId: card.id },
      data: { cardId: null },
    });
    return card;
  }

  describe('createChat', () => {
    it('creates a topic chat with no card', async () => {
      const { ana, board } = await setUp();

      const chat = await chats.createChat(ana.id, board.id, {
        title: 'Release plan',
      });

      expect(chat).toMatchObject({
        boardId: board.id,
        kind: 'TOPIC',
        title: 'Release plan',
        cardId: null,
      });
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, board } = await setUp();

      await expect(
        chats.createChat(ben.id, board.id, { title: 'Release plan' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listChatsForBoard', () => {
    it('lists the general chat first, then the rest oldest first', async () => {
      const { ana, board, toDo } = await setUp();
      await chats.createChat(ana.id, board.id, { title: 'Release plan' });
      await cards.createCard(ana.id, toDo.id, { title: 'Login page' });

      const list = await chats.listChatsForBoard(ana.id, board.id);

      expect(list.map((t) => t.title)).toEqual([
        'General',
        'Release plan',
        'Login page',
      ]);
    });

    it('lists nothing for someone who is not a member', async () => {
      const { ben, board } = await setUp();

      await expect(chats.listChatsForBoard(ben.id, board.id)).resolves.toEqual(
        [],
      );
    });
  });

  describe('linkChatToCard', () => {
    it('links a chat to a card that has none', async () => {
      const { ana, board, toDo } = await setUp();
      const chat = await chats.createChat(ana.id, board.id, {
        title: 'Login ideas',
      });
      const card = await cardWithoutChat(ana.id, toDo.id);

      const linked = await chats.linkChatToCard(ana.id, chat.id, card.id);

      expect(linked.cardId).toBe(card.id);
    });

    it('refuses a card that already has a chat', async () => {
      const { ana, board, toDo } = await setUp();
      const chat = await chats.createChat(ana.id, board.id, {
        title: 'Login ideas',
      });
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });

      await expect(
        chats.linkChatToCard(ana.id, chat.id, card.id),
      ).rejects.toThrow(ConflictException);
    });

    it("refuses to link the board's general chat", async () => {
      const { ana, board, toDo } = await setUp();
      const general = await prisma.chat.findFirstOrThrow({
        where: { boardId: board.id, kind: 'GENERAL' },
      });
      const card = await cardWithoutChat(ana.id, toDo.id);

      await expect(
        chats.linkChatToCard(ana.id, general.id, card.id),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a card on another board', async () => {
      const { ana, project, board } = await setUp();
      const chat = await chats.createChat(ana.id, board.id, {
        title: 'Login ideas',
      });
      const otherBoard = await boards.createBoard(ana.id, project.id, {
        name: 'Sprint 2',
      });
      const otherColumn = await prisma.column.findFirstOrThrow({
        where: { boardId: otherBoard.id },
      });
      const card = await cardWithoutChat(ana.id, otherColumn.id);

      await expect(
        chats.linkChatToCard(ana.id, chat.id, card.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ana, ben, board, toDo } = await setUp();
      const chat = await chats.createChat(ana.id, board.id, {
        title: 'Login ideas',
      });
      const card = await cardWithoutChat(ana.id, toDo.id);

      await expect(
        chats.linkChatToCard(ben.id, chat.id, card.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unlinkChat', () => {
    it('removes the link but keeps both the chat and the card', async () => {
      const { ana, toDo } = await setUp();
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });
      const chat = await prisma.chat.findUniqueOrThrow({
        where: { cardId: card.id },
      });

      const unlinked = await chats.unlinkChat(ana.id, chat.id);

      expect(unlinked.cardId).toBeNull();
      await expect(prisma.card.count()).resolves.toBe(1);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ana, ben, toDo } = await setUp();
      const card = await cards.createCard(ana.id, toDo.id, {
        title: 'Login page',
      });
      const chat = await prisma.chat.findUniqueOrThrow({
        where: { cardId: card.id },
      });

      await expect(chats.unlinkChat(ben.id, chat.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
