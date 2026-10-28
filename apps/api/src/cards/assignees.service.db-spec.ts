import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { AssigneesService } from './assignees.service.js';
import { CardsService } from './cards.service.js';
import { SubtasksService } from './subtasks.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createUser } from '../../test/support/factories.js';

// docs/card-features.md, section 3.
describe('AssigneesService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;
  let assignees: AssigneesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        CardsService,
        SubtasksService,
        AssigneesService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
    assignees = moduleRef.get(AssigneesService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Ana (admin), Cara and Dev (members) in project WEB. Ben is not a member.
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

  function summary(
    list: { user: { displayName: string }; isOwner: boolean }[],
  ) {
    return list.map((a) => `${a.user.displayName}${a.isOwner ? '*' : ''}`);
  }

  it('makes the first person assigned the owner', async () => {
    const { ana, cara, dev, one } = await setUp();

    await assignees.assign(ana.id, one.id, cara.id);
    const list = await assignees.assign(ana.id, one.id, dev.id);

    expect(summary(list)).toEqual(['cara*', 'dev']);
  });

  it('does nothing when the person is already assigned', async () => {
    const { ana, cara, one } = await setUp();
    await assignees.assign(ana.id, one.id, cara.id);

    const list = await assignees.assign(ana.id, one.id, cara.id);

    expect(summary(list)).toEqual(['cara*']);
  });

  it('gives one owner when two people are assigned at the same moment', async () => {
    const { ana, cara, dev, one } = await setUp();

    await Promise.all([
      assignees.assign(ana.id, one.id, cara.id),
      assignees.assign(ana.id, one.id, dev.id),
    ]);

    await expect(
      prisma.cardAssignee.count({ where: { cardId: one.id, isOwner: true } }),
    ).resolves.toBe(1);
  });

  it('changes the owner to another assignee', async () => {
    const { ana, cara, dev, one } = await setUp();
    await assignees.assign(ana.id, one.id, cara.id);
    await assignees.assign(ana.id, one.id, dev.id);

    const list = await assignees.setOwner(ana.id, one.id, dev.id);

    expect(summary(list)).toEqual(['dev*', 'cara']);
  });

  it('refuses an owner who is not assigned', async () => {
    const { ana, cara, one } = await setUp();

    await expect(assignees.setOwner(ana.id, one.id, cara.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('hands ownership to the person assigned longest when the owner is removed', async () => {
    const { ana, cara, dev, one } = await setUp();
    await assignees.assign(ana.id, one.id, cara.id);
    await assignees.assign(ana.id, one.id, dev.id);
    await assignees.assign(ana.id, one.id, ana.id);

    const list = await assignees.unassign(ana.id, one.id, cara.id);

    expect(summary(list)).toEqual(['dev*', 'ana']);
  });

  it('leaves no owner when the last assignee is removed', async () => {
    const { ana, cara, one } = await setUp();
    await assignees.assign(ana.id, one.id, cara.id);

    await expect(assignees.unassign(ana.id, one.id, cara.id)).resolves.toEqual(
      [],
    );
  });

  it('only assigns project members', async () => {
    const { ana, ben, one } = await setUp();

    await expect(assignees.assign(ana.id, one.id, ben.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('starts a new subtask unassigned', async () => {
    const { ana, cara, one, toDo } = await setUp();
    await assignees.assign(ana.id, one.id, cara.id);

    const form = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
      title: 'Form',
    });

    await expect(assignees.listAssignees(ana.id, form.id)).resolves.toEqual([]);
  });

  it('refuses someone who is not a member of the project', async () => {
    const { ben, cara, one } = await setUp();

    await expect(assignees.assign(ben.id, one.id, cara.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(assignees.listAssignees(ben.id, one.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
