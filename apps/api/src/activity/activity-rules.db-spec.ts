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

// The card history behind the Activity tab (docs/card-features.md,
// section 9). Like subtask-rules.db-spec.ts, these write to the database
// directly to prove it refuses bad data. Each refusal names its rule.
describe('Activity rules (database)', () => {
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
    const activity = await prisma.cardActivity.create({
      data: {
        cardId: card.id,
        projectId: project.id,
        actorId: ana.id,
        kind: 'TITLE_CHANGED',
        details: { from: 'Login', to: 'Sign in' },
      },
    });
    return { ana, project, card, activity };
  }

  it('never lets history be changed', async () => {
    const { activity } = await setUp();

    await expect(
      prisma.cardActivity.update({
        where: { id: activity.id },
        data: { details: { from: 'Login', to: 'Hacked' } },
      }),
    ).rejects.toThrow('card history cannot be changed');
  });

  it('never lets history be deleted on its own', async () => {
    const { activity } = await setUp();

    await expect(
      prisma.cardActivity.delete({ where: { id: activity.id } }),
    ).rejects.toThrow('card history cannot be changed');
  });

  it('deletes history with its card', async () => {
    const { card } = await setUp();

    await prisma.card.delete({ where: { id: card.id } });

    await expect(prisma.cardActivity.count()).resolves.toBe(0);
  });

  it('deletes history with its project', async () => {
    const { project } = await setUp();

    await prisma.project.delete({ where: { id: project.id } });

    await expect(prisma.cardActivity.count()).resolves.toBe(0);
  });

  it('keeps history when the person who made the change is deleted', async () => {
    const { ana, project, card } = await setUp();
    // Ana is the project's only admin, so make someone else the actor.
    const ben = await createUser(prisma, 'ben');
    await prisma.$executeRaw`
      INSERT INTO card_activity (id, card_id, project_id, actor_id, kind, details)
      VALUES (gen_random_uuid(), ${card.id}::uuid, ${project.id}::uuid, ${ben.id}::uuid, 'CREATED', '{}')`;

    await prisma.user.delete({ where: { id: ben.id } });

    await expect(
      prisma.cardActivity.findMany({ where: { cardId: card.id } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: null, kind: 'CREATED' }),
        expect.objectContaining({ actorId: ana.id }),
      ]),
    );
  });

  it('keeps history in its card’s project', async () => {
    const { ana, card } = await setUp();
    const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');

    await expect(
      prisma.cardActivity.create({
        data: {
          cardId: card.id,
          projectId: mobile.id,
          actorId: ana.id,
          kind: 'CREATED',
          details: {},
        },
      }),
    ).rejects.toThrow('card_activity_card_id_project_id_fkey');
  });
});
