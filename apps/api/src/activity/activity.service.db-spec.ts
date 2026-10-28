import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BoardsService } from '../boards/boards.service.js';
import { CardsService } from '../cards/cards.service.js';
import { SubtasksService } from '../cards/subtasks.service.js';
import { AssigneesService } from '../cards/assignees.service.js';
import { LabelsService } from '../labels/labels.service.js';
import { TimeEntriesService } from '../time/time-entries.service.js';
import { TimerService } from '../time/timer.service.js';
import { ChecklistsService } from '../checklists/checklists.service.js';
import { ActivityService } from './activity.service.js';
import { resetDatabase } from '../../test/support/reset-database.js';
import { cardScenario } from '../../test/support/card-scenario.js';
import { createUser } from '../../test/support/factories.js';

// The Activity tab (docs/card-features.md, section 9).
describe('ActivityService (database)', () => {
  let prisma: PrismaService;
  let boards: BoardsService;
  let cards: CardsService;
  let subtasks: SubtasksService;
  let assignees: AssigneesService;
  let labels: LabelsService;
  let time: TimeEntriesService;
  let timer: TimerService;
  let checklists: ChecklistsService;
  let activity: ActivityService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BoardsService,
        CardsService,
        SubtasksService,
        AssigneesService,
        LabelsService,
        TimeEntriesService,
        TimerService,
        ChecklistsService,
        ActivityService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    boards = moduleRef.get(BoardsService);
    cards = moduleRef.get(CardsService);
    subtasks = moduleRef.get(SubtasksService);
    assignees = moduleRef.get(AssigneesService);
    labels = moduleRef.get(LabelsService);
    time = moduleRef.get(TimeEntriesService);
    timer = moduleRef.get(TimerService);
    checklists = moduleRef.get(ChecklistsService);
    activity = moduleRef.get(ActivityService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setUp = () => cardScenario(prisma, boards, cards);

  // The card's history, oldest first, as [kind, details] pairs.
  async function history(userId: string, cardId: string) {
    const page = await activity.listActivity(userId, cardId);
    return page.items.reverse().map((line) => [line.kind, line.details]);
  }

  describe('listActivity', () => {
    it('starts with the card being created, by whom', async () => {
      const { ana, one } = await setUp();

      const page = await activity.listActivity(ana.id, one.id);

      expect(page.items).toEqual([
        expect.objectContaining({
          kind: 'CREATED',
          details: { numberPath: '1', title: 'Login' },
          actor: { id: ana.id, displayName: expect.any(String) },
        }),
      ]);
      expect(page.nextBefore).toBeNull();
    });

    it('shows the newest first, a page at a time', async () => {
      const { ana, one } = await setUp();
      for (const title of ['A', 'B', 'C']) {
        await cards.updateCard(ana.id, one.id, { title });
      }

      const first = await activity.listActivity(ana.id, one.id, { limit: 2 });
      const second = await activity.listActivity(ana.id, one.id, {
        limit: 2,
        before: first.nextBefore!,
      });

      expect(first.items.map((l) => l.details)).toEqual([
        { from: 'B', to: 'C' },
        { from: 'A', to: 'B' },
      ]);
      expect(second.items.map((l) => l.kind)).toEqual([
        'TITLE_CHANGED',
        'CREATED',
      ]);
      expect(second.nextBefore).toBeNull();
    });

    it('refuses a bad page size or cursor', async () => {
      const { ana, one } = await setUp();

      await expect(
        activity.listActivity(ana.id, one.id, { limit: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        activity.listActivity(ana.id, one.id, { limit: 101 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        activity.listActivity(ana.id, one.id, { before: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses someone who is not a member of the project', async () => {
      const { ben, one } = await setUp();

      await expect(activity.listActivity(ben.id, one.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('card fields', () => {
    it('records title and description changes with the old and new text', async () => {
      const { ana, one } = await setUp();

      await cards.updateCard(ana.id, one.id, {
        title: ' Sign in ',
        description: 'Email and password',
      });
      await cards.updateCard(ana.id, one.id, { description: '' });

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['TITLE_CHANGED', { from: 'Login', to: 'Sign in' }],
        ['DESCRIPTION_CHANGED', { from: null, to: 'Email and password' }],
        ['DESCRIPTION_CHANGED', { from: 'Email and password', to: null }],
      ]);
    });

    it('refuses a blank or very long title', async () => {
      const { ana, one } = await setUp();

      await expect(
        cards.updateCard(ana.id, one.id, { title: ' ' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        cards.updateCard(ana.id, one.id, { title: 'x'.repeat(201) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records priority, due date and estimate changes', async () => {
      const { ana, one } = await setUp();

      await cards.setPriority(ana.id, one.id, 'HIGH');
      await cards.setDueDate(ana.id, one.id, { date: '2026-11-02' });
      await cards.setEstimate(ana.id, one.id, 90);
      await cards.setEstimate(ana.id, one.id, null);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }],
        [
          'DUE_DATE_CHANGED',
          {
            from: { at: null, hasTime: false },
            to: { at: '2026-11-02T00:00:00.000Z', hasTime: false },
          },
        ],
        ['ESTIMATE_CHANGED', { from: null, to: 90 }],
        ['ESTIMATE_CHANGED', { from: 90, to: null }],
      ]);
    });

    it('records nothing when a value is set to what it already was', async () => {
      const { ana, one } = await setUp();

      await cards.updateCard(ana.id, one.id, { title: 'Login' });
      await cards.setPriority(ana.id, one.id, 'NONE');
      await cards.setDueDate(ana.id, one.id, null);
      await cards.setEstimate(ana.id, one.id, null);

      expect(await history(ana.id, one.id)).toHaveLength(1);
    });
  });

  describe('moves and completion', () => {
    it('records moves between columns by name, and the completion they cause', async () => {
      const { ana, one, toDo, inProgress, done } = await setUp();

      await cards.moveCard(ana.id, one.id, inProgress.id);
      await cards.moveCard(ana.id, one.id, done.id);
      await cards.moveCard(ana.id, one.id, toDo.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        [
          'MOVED',
          {
            from: { columnId: toDo.id, name: toDo.name },
            to: { columnId: inProgress.id, name: inProgress.name },
          },
        ],
        [
          'MOVED',
          expect.objectContaining({
            to: expect.objectContaining({ columnId: done.id }),
          }),
        ],
        ['COMPLETED', {}],
        [
          'MOVED',
          expect.objectContaining({
            to: expect.objectContaining({ columnId: toDo.id }),
          }),
        ],
        ['REOPENED', {}],
      ]);
    });

    it('records completing and reopening by hand, but not repeats', async () => {
      const { ana, one } = await setUp();

      await cards.completeCard(ana.id, one.id);
      await cards.completeCard(ana.id, one.id);
      await cards.reopenCard(ana.id, one.id);
      await cards.reopenCard(ana.id, one.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['COMPLETED', {}],
        ['REOPENED', {}],
      ]);
    });
  });

  describe('subtasks and numbers', () => {
    const ref = (card: { id: string }, numberPath: string, title: string) => ({
      id: card.id,
      numberPath,
      title,
    });

    it('records a new subtask on it and on its parent', async () => {
      const { ana, one, toDo } = await setUp();

      const sub = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      expect(await history(ana.id, sub.id)).toEqual([
        ['CREATED', { numberPath: '1.1', title: 'Form' }],
      ]);
      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['SUBTASK_ADDED', { subtask: ref(sub, '1.1', 'Form') }],
      ]);
    });

    it('records a subtask moving to another parent, and every new number', async () => {
      const { ana, one, two, toDo } = await setUp();
      const sub = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });
      const deeper = await subtasks.createSubtask(ana.id, sub.id, toDo.id, {
        title: 'Field',
      });

      await subtasks.moveToParent(ana.id, sub.id, two.id);

      expect((await history(ana.id, sub.id)).slice(1)).toEqual([
        ['SUBTASK_ADDED', { subtask: ref(deeper, '1.1.1', 'Field') }],
        [
          'PARENT_CHANGED',
          { from: ref(one, '1', 'Login'), to: ref(two, '2', 'Sign-up') },
        ],
        ['NUMBER_CHANGED', { from: '1.1', to: '2.1' }],
      ]);
      expect((await history(ana.id, deeper.id)).slice(1)).toEqual([
        ['NUMBER_CHANGED', { from: '1.1.1', to: '2.1.1' }],
      ]);
      expect((await history(ana.id, one.id)).at(-1)).toEqual([
        'SUBTASK_REMOVED',
        { subtask: ref(sub, '1.1', 'Form'), deleted: false },
      ]);
      expect((await history(ana.id, two.id)).at(-1)).toEqual([
        'SUBTASK_ADDED',
        { subtask: ref(sub, '2.1', 'Form') },
      ]);
    });

    it('records a subtask becoming a top-level card', async () => {
      const { ana, one, toDo } = await setUp();
      const sub = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      await subtasks.moveToParent(ana.id, sub.id, null);

      expect((await history(ana.id, sub.id)).slice(1)).toEqual([
        ['PARENT_CHANGED', { from: ref(one, '1', 'Login'), to: null }],
        ['NUMBER_CHANGED', { from: '1.1', to: '3' }],
      ]);
    });

    it('records a deleted subtask on its parent', async () => {
      const { ana, one, toDo } = await setUp();
      const sub = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      await cards.deleteCard(ana.id, sub.id);

      expect((await history(ana.id, one.id)).at(-1)).toEqual([
        'SUBTASK_REMOVED',
        { subtask: ref(sub, '1.1', 'Form'), deleted: true },
      ]);
    });

    it('keeps a subtask’s history when its parent is deleted and it stays', async () => {
      const { ana, one, toDo } = await setUp();
      const sub = await subtasks.createSubtask(ana.id, one.id, toDo.id, {
        title: 'Form',
      });

      await cards.deleteCard(ana.id, one.id, {
        [sub.id]: { action: 'standalone' },
      });

      expect((await history(ana.id, sub.id)).map(([kind]) => kind)).toEqual([
        'CREATED',
        'PARENT_CHANGED',
        'NUMBER_CHANGED',
      ]);
    });
  });

  describe('assignees and labels', () => {
    // Adds Cara to the project, so there are two people to assign.
    async function setUpWithCara() {
      const scenario = await setUp();
      const cara = await createUser(prisma, 'cara');
      await prisma.projectMember.create({
        data: { projectId: scenario.project.id, userId: cara.id },
      });
      return { ...scenario, cara };
    }

    const person = (user: { id: string; displayName: string }) => ({
      id: user.id,
      displayName: user.displayName,
    });

    it('records assignees and owner changes, by name', async () => {
      const { ana, cara, one } = await setUpWithCara();

      await assignees.assign(ana.id, one.id, ana.id);
      await assignees.assign(ana.id, one.id, cara.id);
      await assignees.assign(ana.id, one.id, cara.id);
      await assignees.setOwner(ana.id, one.id, cara.id);
      await assignees.setOwner(ana.id, one.id, cara.id);
      await assignees.unassign(ana.id, one.id, cara.id);
      await assignees.unassign(ana.id, one.id, ana.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['ASSIGNEE_ADDED', { user: person(ana), isOwner: true }],
        ['ASSIGNEE_ADDED', { user: person(cara), isOwner: false }],
        ['OWNER_CHANGED', { from: person(ana), to: person(cara) }],
        ['ASSIGNEE_REMOVED', { user: person(cara) }],
        ['OWNER_CHANGED', { from: person(cara), to: person(ana) }],
        ['ASSIGNEE_REMOVED', { user: person(ana) }],
      ]);
    });

    it('records labels added and removed, but not repeats', async () => {
      const { ana, project, one } = await setUp();
      const bug = await labels.createLabel(ana.id, project.id, {
        name: 'Bug',
        colour: 'RED',
      });

      await labels.addLabelToCard(ana.id, one.id, bug.id);
      await labels.addLabelToCard(ana.id, one.id, bug.id);
      await labels.removeLabelFromCard(ana.id, one.id, bug.id);
      await labels.removeLabelFromCard(ana.id, one.id, bug.id);

      const label = { labelId: bug.id, name: 'Bug', colour: 'RED' };
      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['LABEL_ADDED', label],
        ['LABEL_REMOVED', label],
      ]);
    });
  });

  describe('time', () => {
    it('records time logged, edited and deleted', async () => {
      const { ana, one } = await setUp();
      const ref = { id: ana.id, displayName: ana.displayName };

      const entry = await time.logTime(ana.id, one.id, {
        minutes: 30,
        workDate: '2026-10-01',
      });
      await time.updateEntry(ana.id, entry.id, { minutes: 45, note: 'Tests' });
      await time.updateEntry(ana.id, entry.id, { minutes: 45 });
      await time.deleteEntry(ana.id, entry.id);

      const was = { minutes: 30, workDate: '2026-10-01', note: null };
      const now = { minutes: 45, workDate: '2026-10-01', note: 'Tests' };
      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        [
          'TIME_LOGGED',
          { entryId: entry.id, user: ref, fromTimer: false, ...was },
        ],
        [
          'TIME_ENTRY_EDITED',
          { entryId: entry.id, user: ref, from: was, to: now },
        ],
        ['TIME_ENTRY_DELETED', { entryId: entry.id, user: ref, ...now }],
      ]);
    });

    it('records time saved by the timer', async () => {
      const { ana, one } = await setUp();
      await timer.startTimer(ana.id, one.id);
      await prisma.runningTimer.update({
        where: { userId: ana.id },
        data: { startedAt: new Date(Date.now() - 10 * 60_000) },
      });

      await timer.stopTimer(ana.id);

      expect((await history(ana.id, one.id)).at(-1)).toEqual([
        'TIME_LOGGED',
        expect.objectContaining({ fromTimer: true, minutes: 10 }),
      ]);
    });
  });

  describe('checklists', () => {
    it('records checklists added, renamed and deleted, but not their items', async () => {
      const { ana, one } = await setUp();

      const list = await checklists.createChecklist(ana.id, one.id, 'Testing');
      const item = await checklists.addItem(ana.id, list.id, 'A');
      await checklists.updateItem(ana.id, item.id, { isDone: true });
      await checklists.renameChecklist(ana.id, list.id, 'QA');
      await checklists.renameChecklist(ana.id, list.id, 'QA');
      await checklists.deleteChecklist(ana.id, list.id);

      expect((await history(ana.id, one.id)).slice(1)).toEqual([
        ['CHECKLIST_ADDED', { checklistId: list.id, name: 'Testing' }],
        [
          'CHECKLIST_RENAMED',
          { checklistId: list.id, from: 'Testing', to: 'QA' },
        ],
        ['CHECKLIST_DELETED', { checklistId: list.id, name: 'QA' }],
      ]);
    });

    it('records an item turned into a subtask once, on the card', async () => {
      const { ana, one } = await setUp();
      const list = await checklists.createChecklist(ana.id, one.id, 'Testing');
      const item = await checklists.addItem(ana.id, list.id, 'Form');

      const sub = await checklists.turnItemIntoSubtask(ana.id, item.id);

      expect((await history(ana.id, one.id)).slice(2)).toEqual([
        [
          'CHECKLIST_ITEM_TO_SUBTASK',
          {
            checklistId: list.id,
            checklistName: 'Testing',
            subtask: { id: sub.id, numberPath: '1.1', title: 'Form' },
          },
        ],
      ]);
      expect(await history(ana.id, sub.id)).toEqual([
        ['CREATED', { numberPath: '1.1', title: 'Form' }],
      ]);
    });
  });
});
