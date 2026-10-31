import type {
  Board,
  BoardCard,
  BoardColumn,
  BoardView,
  Project,
} from '@tessera/shared'

// Example data the fake API answers with, shared by the component tests.

export const website: Project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Website',
  description: 'The public site',
  code: 'WEB',
  timeZone: 'UTC',
  createdAt: '2026-10-30T09:00:00.000Z',
}

export const sprint: Board = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: website.id,
  name: 'Sprint 1',
  createdAt: '2026-10-30T09:00:00.000Z',
}

export const backlog: Board = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: website.id,
  name: 'Backlog',
  createdAt: '2026-10-30T09:00:00.000Z',
}

let nextId = 1
function id(): string {
  const n = String(nextId++).padStart(12, '0')
  return `aaaaaaaa-aaaa-4aaa-8aaa-${n}`
}

// A card with nothing set but its title, plus anything in `fields`.
export function boardCard(
  numberPath: string,
  title: string,
  fields: Partial<BoardCard> = {},
): BoardCard {
  return {
    id: id(),
    projectId: website.id,
    boardId: sprint.id,
    columnId: '',
    numberPath,
    parentId: null,
    depth: numberPath.split('.').length - 1,
    title,
    description: null,
    priority: 'NONE',
    estimateMinutes: null,
    dueAt: null,
    dueHasTime: false,
    isComplete: false,
    completedAt: null,
    position: 0,
    createdById: null,
    createdAt: '2026-10-30T09:00:00.000Z',
    number: `${website.code}-${numberPath}`,
    labels: [],
    assignees: [],
    checklistProgress: { done: 0, total: 0 },
    subtaskProgress: { complete: 0, total: 0 },
    threadId: id(),
    ...fields,
  }
}

// A column holding `cards` from top to bottom.
export function boardColumn(
  name: string,
  cards: BoardCard[],
  fields: Partial<BoardColumn> = {},
): BoardColumn {
  const columnId = fields.id ?? id()
  return {
    id: columnId,
    boardId: sprint.id,
    name,
    position: 0,
    isDone: false,
    createdAt: '2026-10-30T09:00:00.000Z',
    ...fields,
    cards: cards.map((card, position) => ({
      ...card,
      columnId,
      position,
    })),
  }
}

export function boardView(columns: BoardColumn[]): BoardView {
  return {
    ...sprint,
    columns: columns.map((column, position) => ({ ...column, position })),
  }
}
