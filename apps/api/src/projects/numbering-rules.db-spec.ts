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

// Project codes and card numbers (docs/card-features.md, section 1).
// Like board-rules.db-spec.ts, these write to the database directly to prove
// the database itself refuses bad data. Each refusal names its constraint.
describe('Project code and card number rules (database)', () => {
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

  async function admin() {
    return createUser(prisma, 'ana');
  }

  describe('project codes', () => {
    it.each(['web', 'W', 'WEB1', 'WE B', 'WÉB'])(
      'refuses the badly formed code "%s"',
      async (code) => {
        const ana = await admin();
        const project = await createProject(prisma, ana.id, 'Website', 'OK');

        await expect(
          prisma.project.create({ data: { name: 'Website', code } }),
        ).rejects.toThrow('projects_code_format');
        await expect(
          prisma.projectCode.create({ data: { code, projectId: project.id } }),
        ).rejects.toThrow('project_codes_code_format');
      },
    );

    it('refuses a code longer than 6 letters', async () => {
      await expect(
        prisma.project.create({ data: { name: 'Website', code: 'WEBSITE' } }),
      ).rejects.toThrow('too long');
    });

    it('refuses two projects with the same code', async () => {
      const ana = await admin();
      await createProject(prisma, ana.id, 'Website', 'WEB');

      await expect(
        createProject(prisma, ana.id, 'Web shop', 'WEB'),
      ).rejects.toThrow('projects_code_key');
    });

    it("refuses another project's old code", async () => {
      const ana = await admin();
      const website = await createProject(prisma, ana.id, 'Website', 'WEB');
      await prisma.project.update({
        where: { id: website.id },
        data: { code: 'SITE', codes: { create: { code: 'SITE' } } },
      });

      await expect(
        createProject(prisma, ana.id, 'Web shop', 'WEB'),
      ).rejects.toThrow('project_codes_pkey');
    });

    it("deletes a project's codes with the project", async () => {
      const ana = await admin();
      const website = await createProject(prisma, ana.id, 'Website', 'WEB');

      await prisma.project.delete({ where: { id: website.id } });

      await expect(prisma.projectCode.count()).resolves.toBe(0);
    });
  });

  describe('card numbers', () => {
    async function setUp() {
      const ana = await admin();
      const project = await createProject(prisma, ana.id, 'Website', 'WEB');
      const { board, column } = await createBareBoard(prisma, project.id);
      return { ana, project, board, column };
    }

    it('refuses two cards with the same number in a project', async () => {
      const { project, board, column } = await setUp();
      await createBareCard(prisma, { boardId: board.id, columnId: column.id });

      await expect(
        prisma.card.create({
          data: {
            projectId: project.id,
            boardId: board.id,
            columnId: column.id,
            title: 'Copy',
            position: 1,
            numberPath: '1',
          },
        }),
      ).rejects.toThrow('cards_project_id_number_path_key');
    });

    it('allows the same number in different projects', async () => {
      const { ana, board, column } = await setUp();
      const other = await createProject(prisma, ana.id, 'Mobile app', 'MOB');
      const otherBoard = await createBareBoard(prisma, other.id);

      const first = await createBareCard(prisma, {
        boardId: board.id,
        columnId: column.id,
      });
      const second = await createBareCard(prisma, {
        boardId: otherBoard.board.id,
        columnId: otherBoard.column.id,
      });

      expect(first.numberPath).toBe('1');
      expect(second.numberPath).toBe('1');
    });

    it.each(['0', '01', '1.', '1..2', '1.0', 'a', ''])(
      'refuses the badly formed number "%s"',
      async (numberPath) => {
        const { project, board, column } = await setUp();

        await expect(
          prisma.card.create({
            data: {
              projectId: project.id,
              boardId: board.id,
              columnId: column.id,
              title: 'Login page',
              position: 0,
              numberPath,
            },
          }),
        ).rejects.toThrow('cards_number_path_format');
      },
    );

    it("refuses a card whose project is not its board's project", async () => {
      const { ana, board, column } = await setUp();
      const other = await createProject(prisma, ana.id, 'Mobile app', 'MOB');

      await expect(
        prisma.card.create({
          data: {
            projectId: other.id,
            boardId: board.id,
            columnId: column.id,
            title: 'Login page',
            position: 0,
            numberPath: '1',
          },
        }),
      ).rejects.toThrow('cards_board_id_project_id_fkey');
    });
  });
});
