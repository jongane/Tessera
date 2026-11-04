import type { BoardCard } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { website } from './fixtures'
import { apiError } from './server'

// The fake API's checklists, for the card panel's tests. The shapes follow
// what the real API answers (docs/api.md, "Checklists").

export interface FakeChecklistItem {
  id: string
  checklistId: string
  text: string
  isDone: boolean
  position: number
  createdAt: string
}

export interface FakeChecklist {
  id: string
  cardId: string
  projectId: string
  name: string
  position: number
  createdAt: string
  items: FakeChecklistItem[]
}

let nextId = 1
function id(): string {
  return `cccccccc-cccc-4ccc-8ccc-${String(nextId++).padStart(12, '0')}`
}

// A checklist named `name` with `items` in order. An item given as
// [text, true] is ticked. The card is filled in when the fake API takes it.
export function checklist(
  name: string,
  items: (string | [string, boolean])[] = [],
): FakeChecklist {
  const checklistId = id()
  return {
    id: checklistId,
    cardId: '',
    projectId: website.id,
    name,
    position: 0,
    createdAt: '2026-10-30T09:00:00.000Z',
    items: items.map((item, position) => {
      const [text, isDone] = typeof item === 'string' ? [item, false] : item
      return {
        id: id(),
        checklistId,
        text,
        isDone,
        position,
        createdAt: '2026-10-30T09:00:00.000Z',
      }
    }),
  }
}

// The item called `text`, to find its id in a test.
export function itemOf(list: FakeChecklist, text: string): FakeChecklistItem {
  const item = list.items.find((i) => i.text === text)
  if (!item) throw new Error(`No item “${text}” in ${list.name}`)
  return item
}

const MAX_ITEMS = 100
const MAX_DEPTH = 4

function progress(list: FakeChecklist) {
  return {
    done: list.items.filter((item) => item.isDone).length,
    total: list.items.length,
  }
}

function moveTo<T extends { position: number }>(
  all: T[],
  moved: T,
  position: number,
): T[] {
  const rest = all.filter((x) => x !== moved)
  rest.splice(Math.min(position, rest.length), 0, moved)
  return rest.map((x, i) => Object.assign(x, { position: i }))
}

// Handlers that remember changes, so the panel reloads with what was saved.
// `record` adds a change to the board's list of requests; `addSubtask`
// puts a new subtask of the card on the board.
export function checklistHandlers({
  start,
  record,
  cardOf,
  addSubtask,
  onChange,
}: {
  // By card id.
  start: Record<string, FakeChecklist[]>
  record: (request: Request) => Promise<void>
  cardOf: (cardId: string) => BoardCard | undefined
  addSubtask: (parent: BoardCard, title: string) => BoardCard
  // After every change to a card's checklists, with their totals.
  onChange: (cardId: string, done: number, total: number) => void
}) {
  let lists: FakeChecklist[] = Object.entries(start).flatMap(
    ([cardId, cardLists]) =>
      cardLists.map((list, position) => ({
        ...structuredClone(list),
        cardId,
        position,
      })),
  )

  function listsOf(cardId: string) {
    return lists
      .filter((list) => list.cardId === cardId)
      .sort((a, b) => a.position - b.position)
  }

  function findItem(itemId: string) {
    for (const list of lists) {
      const item = list.items.find((i) => i.id === itemId)
      if (item) return { list, item }
    }
    return undefined
  }

  function changed(cardId: string) {
    const items = listsOf(cardId).flatMap((list) => list.items)
    onChange(cardId, items.filter((i) => i.isDone).length, items.length)
  }

  return [
    http.get('/api/cards/:cardId/checklists', ({ params }) =>
      HttpResponse.json(
        listsOf(String(params.cardId)).map((list) => ({
          ...list,
          progress: progress(list),
        })),
      ),
    ),
    http.post('/api/cards/:cardId/checklists', async ({ request, params }) => {
      await record(request.clone())
      const { name } = (await request.json()) as { name: string }
      const cardId = String(params.cardId)
      const existing = listsOf(cardId)
      const created: FakeChecklist = {
        ...checklist(name.trim()),
        cardId,
        position: existing.length,
      }
      lists = [...lists, created]
      const { items: _items, ...answer } = created
      return HttpResponse.json(
        { ...answer, suggestNewCard: existing.length + 1 > 10 },
        { status: 201 },
      )
    }),
    http.patch('/api/checklists/:checklistId', async ({ request, params }) => {
      await record(request.clone())
      const body = (await request.json()) as {
        name?: string
        position?: number
      }
      const list = lists.find((l) => l.id === params.checklistId)
      if (!list) return apiError(404, 'Checklist not found')
      if (body.name !== undefined) list.name = body.name.trim()
      if (body.position !== undefined) {
        moveTo(listsOf(list.cardId), list, body.position)
      }
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/checklists/:checklistId', async ({ request, params }) => {
      await record(request)
      const list = lists.find((l) => l.id === params.checklistId)
      if (!list) return apiError(404, 'Checklist not found')
      lists = lists.filter((l) => l !== list)
      listsOf(list.cardId).forEach((l, i) => (l.position = i))
      changed(list.cardId)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(
      '/api/checklists/:checklistId/items',
      async ({ request, params }) => {
        await record(request.clone())
        const { text } = (await request.json()) as { text: string }
        const list = lists.find((l) => l.id === params.checklistId)
        if (!list) return apiError(404, 'Checklist not found')
        if (list.items.length >= MAX_ITEMS) {
          return apiError(
            409,
            `A checklist can have at most ${MAX_ITEMS} items`,
          )
        }
        const item: FakeChecklistItem = {
          id: id(),
          checklistId: list.id,
          text: text.trim(),
          isDone: false,
          position: list.items.length,
          createdAt: '2026-11-03T09:00:00.000Z',
        }
        list.items = [...list.items, item]
        changed(list.cardId)
        return HttpResponse.json(item, { status: 201 })
      },
    ),
    http.patch('/api/checklist-items/:itemId', async ({ request, params }) => {
      await record(request.clone())
      const body = (await request.json()) as {
        text?: string
        isDone?: boolean
        position?: number
      }
      const found = findItem(String(params.itemId))
      if (!found) return apiError(404, 'Checklist item not found')
      const { list, item } = found
      if (body.text !== undefined) item.text = body.text.trim()
      if (body.isDone !== undefined) item.isDone = body.isDone
      if (body.position !== undefined) {
        list.items = moveTo(list.items, item, body.position)
      }
      changed(list.cardId)
      return HttpResponse.json(item)
    }),
    http.delete('/api/checklist-items/:itemId', async ({ request, params }) => {
      await record(request)
      const found = findItem(String(params.itemId))
      if (!found) return apiError(404, 'Checklist item not found')
      const { list, item } = found
      list.items = list.items
        .filter((i) => i !== item)
        .map((i, position) => ({ ...i, position }))
      changed(list.cardId)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(
      '/api/checklist-items/:itemId/subtask',
      async ({ request, params }) => {
        await record(request)
        const found = findItem(String(params.itemId))
        if (!found) return apiError(404, 'Checklist item not found')
        const { list, item } = found
        const parent = cardOf(list.cardId)!
        if (parent.depth >= MAX_DEPTH) {
          return apiError(
            409,
            `Subtasks can only go ${MAX_DEPTH + 1} levels deep`,
          )
        }
        list.items = list.items
          .filter((i) => i !== item)
          .map((i, position) => ({ ...i, position }))
        changed(list.cardId)
        return HttpResponse.json(addSubtask(parent, item.text), {
          status: 201,
        })
      },
    ),
  ]
}
