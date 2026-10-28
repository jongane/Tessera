import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { LabelsService } from './labels.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createProject, createUser } from '../../test/support/factories.js';

// docs/card-features.md, sections 8 and 10.
describe('LabelsService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let labels: LabelsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BoardsService, CardsService, LabelsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    labels = moduleRef.get(LabelsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Ana is the admin, Cara an ordinary member, Ben not a member.
  async function setUp() {
    const scenario = await cardScenario(prisma, boards, cards);
    const cara = await createUser(prisma, 'cara');
    await prisma.projectMember.create({
      data: { projectId: scenario.project.id, userId: cara.id },
    });
    return { ...scenario, cara };
  }

  describe('createLabel', () => {
    it('lets any member create a label', async () => {
      const { cara, project } = await setUp();

      const bug = await labels.createLabel(cara.id, project.id, {
        name: '  Bug ',
        colour: 'RED',
      });

      expect(bug).toMatchObject({
        projectId: project.id,
        name: 'Bug',
        colour: 'RED',
      });
    });

    it('refuses a name already used in the project, in any letter case', async () => {
      const { cara, project } = await setUp();
      await labels.createLabel(cara.id, project.id, {
        name: 'Bug',
        colour: 'RED',
      });

      await expect(
        labels.createLabel(cara.id, project.id, {
          name: 'bug',
          colour: 'BLUE',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a blank or very long name, and a colour not in the set', async () => {
      const { cara, project } = await setUp();

      await expect(
        labels.createLabel(cara.id, project.id, { name: ' ', colour: 'RED' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        labels.createLabel(cara.id, project.id, {
          name: 'x'.repeat(51),
          colour: 'RED',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        labels.createLabel(cara.id, project.id, {
          name: 'Bug',
          colour: '#ff0000',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, project } = await setUp();

      await expect(
        labels.createLabel(ben.id, project.id, { name: 'Bug', colour: 'RED' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLabel and deleteLabel', () => {
    async function setUpWithLabel() {
      const setup = await setUp();
      const bug = await labels.createLabel(setup.cara.id, setup.project.id, {
        name: 'Bug',
        colour: 'RED',
      });
      return { ...setup, bug };
    }

    it('lets an admin rename, recolour and delete a label', async () => {
      const { ana, bug } = await setUpWithLabel();

      await expect(
        labels.updateLabel(ana.id, bug.id, { name: 'Defect', colour: 'PINK' }),
      ).resolves.toMatchObject({ name: 'Defect', colour: 'PINK' });
      await labels.deleteLabel(ana.id, bug.id);
      await expect(prisma.label.count()).resolves.toBe(0);
    });

    it('refuses an ordinary member, even the person who created it', async () => {
      const { cara, bug } = await setUpWithLabel();

      await expect(
        labels.updateLabel(cara.id, bug.id, { name: 'Defect' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(labels.deleteLabel(cara.id, bug.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a new name another label already has', async () => {
      const { ana, cara, project, bug } = await setUpWithLabel();
      await labels.createLabel(cara.id, project.id, {
        name: 'Feature',
        colour: 'BLUE',
      });

      await expect(
        labels.updateLabel(ana.id, bug.id, { name: 'FEATURE' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        labels.updateLabel(ana.id, bug.id, { name: 'BUG' }),
      ).resolves.toMatchObject({ name: 'BUG' });
    });

    it('treats a label in another project as not found', async () => {
      const { ben, bug } = await setUpWithLabel();

      await expect(
        labels.updateLabel(ben.id, bug.id, { name: 'Defect' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('labels on cards', () => {
    it('puts labels on a card and lists them by name', async () => {
      const { cara, project, one } = await setUp();
      const ui = await labels.createLabel(cara.id, project.id, {
        name: 'UI',
        colour: 'TEAL',
      });
      const bug = await labels.createLabel(cara.id, project.id, {
        name: 'Bug',
        colour: 'RED',
      });

      await labels.addLabelToCard(cara.id, one.id, ui.id);
      await labels.addLabelToCard(cara.id, one.id, bug.id);
      await labels.addLabelToCard(cara.id, one.id, bug.id);

      const onCard = await labels.labelsForCard(cara.id, one.id);
      expect(onCard.map((l) => l.name)).toEqual(['Bug', 'UI']);
    });

    it('takes a label off a card', async () => {
      const { cara, project, one } = await setUp();
      const bug = await labels.createLabel(cara.id, project.id, {
        name: 'Bug',
        colour: 'RED',
      });
      await labels.addLabelToCard(cara.id, one.id, bug.id);

      await labels.removeLabelFromCard(cara.id, one.id, bug.id);

      await expect(labels.labelsForCard(cara.id, one.id)).resolves.toEqual([]);
    });

    it('refuses a label from another project', async () => {
      const { ana, one } = await setUp();
      const mobile = await createProject(prisma, ana.id, 'Mobile', 'MOB');
      const mobileLabel = await labels.createLabel(ana.id, mobile.id, {
        name: 'Bug',
        colour: 'RED',
      });

      await expect(
        labels.addLabelToCard(ana.id, one.id, mobileLabel.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists the project’s labels by name, to members only', async () => {
      const { ben, cara, project } = await setUp();
      await labels.createLabel(cara.id, project.id, {
        name: 'UI',
        colour: 'TEAL',
      });
      await labels.createLabel(cara.id, project.id, {
        name: 'bug',
        colour: 'RED',
      });

      const list = await labels.listLabels(cara.id, project.id);
      expect(list.map((l) => l.name)).toEqual(['bug', 'UI']);
      await expect(labels.listLabels(ben.id, project.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
