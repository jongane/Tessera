import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { CardSearchService } from './card-search.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { createProject, createUser } from '../../test/support/factories.js';

describe('CardSearchService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let projects: ProjectsService;
  let cards: CardsService;
  let subtasks: SubtasksService;
  let search: CardSearchService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        ProjectsService,
        CardsService,
        SubtasksService,
        CardSearchService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    projects = moduleRef.get(ProjectsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
    search = moduleRef.get(CardSearchService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Project WEB, owned by Ana, with boards "Sprint 1" and "Backlog". Ben is
  // not a member.
  async function setUp() {
    const ana = await createUser(prisma, 'ana');
    const ben = await createUser(prisma, 'ben');
    const project = await createProject(prisma, ana.id, 'Website', 'WEB');
    const sprint = await boards.createBoard(ana.id, project.id, {
      name: 'Sprint 1',
    });
    const backlog = await boards.createBoard(ana.id, project.id, {
      name: 'Backlog',
    });
    const firstColumn = (boardId: string) =>
      prisma.column.findFirstOrThrow({ where: { boardId, position: 0 } });
    const sprintToDo = await firstColumn(sprint.id);
    const backlogToDo = await firstColumn(backlog.id);
    const add = (title: string, columnId = sprintToDo.id) =>
      cards.createCard(ana.id, columnId, { title });
    return { ana, ben, project, sprint, backlog, sprintToDo, backlogToDo, add };
  }

  const numbers = (result: { cards: { number: string }[] }) =>
    result.cards.map((card) => card.number);

  describe('by number', () => {
    it('finds a card by its number, in any letter case, then its subtasks', async () => {
      const { ana, project, sprintToDo, add } = await setUp();
      const login = await add('Login');
      await add('Sign-up');
      const form = await subtasks.createSubtask(
        ana.id,
        login.id,
        sprintToDo.id,
        { title: 'Form' },
      );
      await subtasks.createSubtask(ana.id, form.id, sprintToDo.id, {
        title: 'Validation',
      });

      for (const q of ['WEB-1', 'web-1', '1']) {
        expect(numbers(await search.search(ana.id, project.id, { q }))).toEqual(
          ['WEB-1', 'WEB-1.1', 'WEB-1.1.1'],
        );
      }
      expect(
        numbers(await search.search(ana.id, project.id, { q: 'WEB-1.1' })),
      ).toEqual(['WEB-1.1', 'WEB-1.1.1']);
    });

    it('does not treat WEB-1 as the start of WEB-12', async () => {
      const { ana, project, add } = await setUp();
      for (let i = 1; i <= 12; i++) {
        await add(`Card ${String.fromCharCode(64 + i)}`);
      }

      expect(
        numbers(await search.search(ana.id, project.id, { q: 'WEB-1' })),
      ).toEqual(['WEB-1']);
      expect(
        numbers(await search.search(ana.id, project.id, { q: 'WEB-12' })),
      ).toEqual(['WEB-12']);
    });

    it('finds a card by an old number or an old project code', async () => {
      const { ana, project, sprintToDo, add } = await setUp();
      const login = await add('Login');
      const signUp = await add('Sign-up');
      const form = await subtasks.createSubtask(
        ana.id,
        login.id,
        sprintToDo.id,
        { title: 'Form' },
      );
      // WEB-1.1 becomes WEB-2.1.
      await subtasks.moveToParent(ana.id, form.id, signUp.id);
      await projects.changeProjectCode(ana.id, project.id, 'SITE');

      const result = await search.search(ana.id, project.id, { q: 'WEB-1.1' });

      expect(result.cards).toEqual([
        expect.objectContaining({ id: form.id, number: 'SITE-2.1' }),
      ]);
    });

    it('treats another project’s code as words from a title', async () => {
      const { ana, project, add } = await setUp();
      await add('Login');
      await createProject(prisma, ana.id, 'Other', 'APP');

      expect(
        numbers(await search.search(ana.id, project.id, { q: 'APP-1' })),
      ).toEqual([]);
    });
  });

  describe('by title', () => {
    it('finds cards whose title contains the words, in any letter case, in number order', async () => {
      const { ana, project, add } = await setUp();
      await add('Login page');
      await add('Payments');
      await add('Fix LOGIN errors');

      expect(
        numbers(await search.search(ana.id, project.id, { q: 'login' })),
      ).toEqual(['WEB-1', 'WEB-3']);
    });

    it('treats %, _ and \\ as ordinary characters', async () => {
      const { ana, project, add } = await setUp();
      await add('Show 50% off');
      await add('Show 500 items');
      await add('snake_case names');
      await add('snakeXcase names');
      await add('C:\\temp');

      expect(
        numbers(await search.search(ana.id, project.id, { q: '50%' })),
      ).toEqual(['WEB-1']);
      expect(
        numbers(await search.search(ana.id, project.id, { q: 'snake_' })),
      ).toEqual(['WEB-3']);
      expect(
        numbers(await search.search(ana.id, project.id, { q: ':\\t' })),
      ).toEqual(['WEB-5']);
    });

    it('lists number matches first, without repeating a card', async () => {
      const { ana, project, add } = await setUp();
      await add('Release 2');
      await add('Plan release');

      expect(
        numbers(await search.search(ana.id, project.id, { q: '2' })),
      ).toEqual(['WEB-2', 'WEB-1']);
    });
  });

  it('searches every board of the project, giving each card’s board and depth', async () => {
    const { ana, project, sprint, backlog, backlogToDo, add } = await setUp();
    const login = await add('Login');
    const form = await subtasks.createSubtask(
      ana.id,
      login.id,
      backlogToDo.id,
      { title: 'Login form' },
    );
    const other = await createProject(prisma, ana.id, 'Other', 'APP');
    const otherBoard = await boards.createBoard(ana.id, other.id, {
      name: 'Other board',
    });
    const otherColumn = await prisma.column.findFirstOrThrow({
      where: { boardId: otherBoard.id, position: 0 },
    });
    await cards.createCard(ana.id, otherColumn.id, { title: 'Login' });

    const result = await search.search(ana.id, project.id, { q: 'login' });

    expect(result.cards).toEqual([
      {
        id: login.id,
        number: 'WEB-1',
        title: 'Login',
        boardId: sprint.id,
        boardName: 'Sprint 1',
        isComplete: false,
        depth: 0,
      },
      {
        id: form.id,
        number: 'WEB-1.1',
        title: 'Login form',
        boardId: backlog.id,
        boardName: 'Backlog',
        isComplete: false,
        depth: 1,
      },
    ]);
  });

  it('gives at most 20 cards, or the limit asked for', async () => {
    const { ana, project, add } = await setUp();
    for (let i = 1; i <= 25; i++) {
      await add(`Task ${i}`);
    }

    expect(
      (await search.search(ana.id, project.id, { q: 'task' })).cards,
    ).toHaveLength(20);
    expect(
      numbers(await search.search(ana.id, project.id, { q: 'task', limit: 3 })),
    ).toHaveLength(3);
  });

  it('tells people who are not members that the project was not found', async () => {
    const { ben, project, add } = await setUp();
    await add('Login');

    await expect(
      search.search(ben.id, project.id, { q: 'login' }),
    ).rejects.toThrow(NotFoundException);
  });
});
