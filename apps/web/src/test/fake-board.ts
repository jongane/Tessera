import type {
  BoardCard,
  BoardView,
  CardChangesBody,
  CardRelatives,
  Chat,
  Label,
  Me,
  Project,
  ProjectMember,
  RelatedCard,
  SubtaskListItem,
} from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { checklistHandlers, type FakeChecklist } from './fake-checklists'
import { backlog, boardCard, boardColumn, sprint, website } from './fixtures'
import { ana, apiError, server, signedInAs } from './server'

// The Backlog board's columns, for the Column choice of a new subtask and
// for cards "on another board".
export const backlogColumns = {
  ideas: '88888888-8888-4888-8888-000000000101',
  later: '88888888-8888-4888-8888-000000000102',
  shipped: '88888888-8888-4888-8888-000000000103',
}

// A card on the Backlog board, in its “Ideas” column unless `fields` say
// otherwise. Give it to `fakeBoard` as `elsewhere`.
export function backlogCard(
  numberPath: string,
  title: string,
  fields: Partial<BoardCard> = {},
): BoardCard {
  return boardCard(numberPath, title, {
    boardId: backlog.id,
    columnId: backlogColumns.ideas,
    ...fields,
  })
}

const MAX_DEPTH = 4

export const ben: Me = {
  id: '66666666-6666-4666-8666-666666666666',
  email: 'ben@example.com',
  displayName: 'Ben',
  isServerAdmin: false,
}

export function member(person: Me, role: ProjectMember['role']): ProjectMember {
  return {
    userId: person.id,
    displayName: person.displayName,
    email: person.email,
    role,
    joinedAt: '2026-10-30T09:00:00.000Z',
  }
}

let nextLabel = 1

export function label(name: string, colour: Label['colour']): Label {
  return {
    id: `77777777-7777-4777-8777-${String(nextLabel++).padStart(12, '0')}`,
    projectId: website.id,
    name,
    colour,
    createdAt: '2026-10-30T09:00:00.000Z',
  }
}

export interface FakeBoardOptions {
  me?: Me
  members?: ProjectMember[]
  labels?: Label[]
  project?: Project
  chats?: Chat[]
  // By card id; a card not listed has no relatives.
  relatives?: Record<string, CardRelatives>
  // By card id; a card not listed has no checklists.
  checklists?: Record<string, FakeChecklist[]>
  // Cards on the Backlog board (see `backlogCard`). They can be found with
  // the card search and listed as subtasks of cards on this board.
  elsewhere?: BoardCard[]
}

// A fake API for one board that remembers changes to its cards, so the
// board reloads with what was saved, as the real one does. `requests` lists
// every change sent, as "METHOD /path" with its body.
export function fakeBoard(
  start: BoardView,
  {
    me = ana,
    members = [member(ana, 'ADMIN'), member(ben, 'MEMBER')],
    labels = [],
    project = website,
    chats = [],
    relatives = {},
    checklists = {},
    elsewhere: startElsewhere = [],
  }: FakeBoardOptions = {},
) {
  let view = structuredClone(start)
  let elsewhere = structuredClone(startElsewhere)
  // The Backlog board's own request, to see when it is loaded.
  const boardsRead: string[] = []
  // What was typed into the card search, one entry per request.
  const searches: string[] = []
  const requests: { request: string; body: unknown }[] = []

  function update(cardId: string, change: (card: BoardCard) => BoardCard) {
    view = {
      ...view,
      columns: view.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) =>
          card.id === cardId ? change(card) : card,
        ),
      })),
    }
  }

  function backlogView(): BoardView {
    return {
      ...backlog,
      columns: [
        boardColumn('Ideas', [], {
          id: backlogColumns.ideas,
          boardId: backlog.id,
        }),
        boardColumn('Later', [], {
          id: backlogColumns.later,
          boardId: backlog.id,
        }),
        boardColumn('Shipped', [], {
          id: backlogColumns.shipped,
          boardId: backlog.id,
          isDone: true,
        }),
      ].map((column, position) => ({
        ...column,
        position,
        cards: elsewhere.filter((c) => c.columnId === column.id),
      })),
    }
  }

  function allCards(): BoardCard[] {
    return [...view.columns.flatMap((column) => column.cards), ...elsewhere]
  }

  function boardOf(boardId: string): BoardView {
    return boardId === backlog.id ? backlogView() : view
  }

  // Changes a card wherever it is, on this board or on the Backlog.
  function patch(cardId: string, change: (card: BoardCard) => BoardCard) {
    update(cardId, change)
    elsewhere = elsewhere.map((c) => (c.id === cardId ? change(c) : c))
  }

  function anyCard(cardId: string) {
    return allCards().find((c) => c.id === cardId)
  }

  function childrenOf(cardId: string) {
    return allCards()
      .filter((c) => c.parentId === cardId)
      .sort((a, b) =>
        a.numberPath.localeCompare(b.numberPath, undefined, { numeric: true }),
      )
  }

  function descendantsOf(cardId: string): { card: BoardCard; level: number }[] {
    return childrenOf(cardId).flatMap((child) => [
      { card: child, level: 1 },
      ...descendantsOf(child.id).map(({ card, level }) => ({
        card,
        level: level + 1,
      })),
    ])
  }

  function height(cardId: string): number {
    return Math.max(0, ...childrenOf(cardId).map((c) => 1 + height(c.id)))
  }

  function columnNameOf(card: BoardCard) {
    return (
      boardOf(card.boardId).columns.find((c) => c.id === card.columnId)?.name ??
      ''
    )
  }

  function boardNameOf(card: BoardCard) {
    return card.boardId === backlog.id ? backlog.name : sprint.name
  }

  function related(c: BoardCard): RelatedCard {
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      boardId: c.boardId,
      boardName: boardNameOf(c),
      isComplete: c.isComplete,
    }
  }

  function computedRelatives(cardId: string): CardRelatives {
    const found = anyCard(cardId)
    const parents: RelatedCard[] = []
    for (let p = found?.parentId; p;) {
      const parent = anyCard(p)
      if (!parent) break
      parents.push(related(parent))
      p = parent.parentId
    }
    return {
      parents,
      subtasks: descendantsOf(cardId).map(({ card, level }) => ({
        ...related(card),
        level,
      })),
      siblings: found?.parentId
        ? childrenOf(found.parentId)
            .filter((c) => c.id !== cardId)
            .map(related)
        : [],
    }
  }

  function listItem(c: BoardCard): SubtaskListItem {
    return {
      ...c,
      columnName: columnNameOf(c),
      boardName: boardNameOf(c),
    }
  }

  // Renumbers a card and, under it, its subtasks.
  function renumber(cardId: string, numberPath: string) {
    patch(cardId, (c) => ({
      ...c,
      numberPath,
      number: `${website.code}-${numberPath}`,
      depth: numberPath.split('.').length - 1,
    }))
    childrenOf(cardId).forEach((child, i) =>
      renumber(child.id, `${numberPath}.${i + 1}`),
    )
  }

  // Gives a card a new parent (null: the top level). Gives the API's
  // answer when that is not allowed.
  function reparent(cardId: string, parentId: string | null) {
    const moved = anyCard(cardId)
    if (!moved) return apiError(404, 'Card not found')
    const parent = parentId ? anyCard(parentId) : undefined
    if (parentId && !parent) return apiError(404, 'Card not found')
    if (
      parent &&
      (parent.id === cardId ||
        descendantsOf(cardId).some(({ card }) => card.id === parent.id))
    ) {
      return apiError(409, 'A card can’t become a subtask of its own subtask')
    }
    if (parent && parent.depth + 1 + height(cardId) > MAX_DEPTH) {
      return apiError(409, `Subtasks can only go ${MAX_DEPTH + 1} levels deep`)
    }
    const progressStep = (c: BoardCard, by: number) => ({
      ...c,
      subtaskProgress: {
        complete: c.subtaskProgress.complete + (moved.isComplete ? by : 0),
        total: c.subtaskProgress.total + by,
      },
    })
    if (moved.parentId) patch(moved.parentId, (c) => progressStep(c, -1))
    patch(cardId, (c) => ({ ...c, parentId }))
    const numberPath = parent
      ? `${parent.numberPath}.${childrenOf(parent.id).length}`
      : String(
          1 +
            Math.max(
              11,
              ...allCards()
                .filter((c) => c.parentId === null && c.id !== cardId)
                .map((c) => Number(c.numberPath)),
            ),
        )
    if (parent) patch(parent.id, (c) => progressStep(c, 1))
    renumber(cardId, numberPath)
    return undefined
  }

  function removeCard(cardId: string) {
    const gone = anyCard(cardId)
    if (gone?.parentId) {
      patch(gone.parentId, (c) => ({
        ...c,
        subtaskProgress: {
          complete: c.subtaskProgress.complete - (gone.isComplete ? 1 : 0),
          total: c.subtaskProgress.total - 1,
        },
      }))
    }
    view = {
      ...view,
      columns: view.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((c) => c.id !== cardId),
      })),
    }
    elsewhere = elsewhere.filter((c) => c.id !== cardId)
  }

  function card(cardId: string) {
    return view.columns
      .flatMap((column) => column.cards)
      .find((c) => c.id === cardId)
  }

  async function record(request: Request) {
    const text = await request.text()
    requests.push({
      request: `${request.method} ${new URL(request.url).pathname}`,
      body: text ? JSON.parse(text) : undefined,
    })
  }

  // A new subtask of `parent`, at the bottom of the parent's column.
  function addSubtask(parent: BoardCard, title: string): BoardCard {
    const n = parent.subtaskProgress.total + 1
    const column = view.columns.find((c) => c.id === parent.columnId)!
    const subtask = boardCard(`${parent.numberPath}.${n}`, title, {
      parentId: parent.id,
      boardId: parent.boardId,
      columnId: column.id,
      position: column.cards.length,
    })
    view = {
      ...view,
      columns: view.columns.map((c) =>
        c.id === column.id ? { ...c, cards: [...c.cards, subtask] } : c,
      ),
    }
    update(parent.id, (c) => ({
      ...c,
      subtaskProgress: { ...c.subtaskProgress, total: n },
    }))
    return subtask
  }

  server.use(
    ...checklistHandlers({
      start: checklists,
      record,
      cardOf: card,
      addSubtask,
      onChange: (cardId, done, total) =>
        update(cardId, (c) => ({ ...c, checklistProgress: { done, total } })),
    }),
    signedInAs(me),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(project)),
    http.get(`/api/projects/${website.id}/boards`, () =>
      HttpResponse.json([backlog, sprint]),
    ),
    http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
    http.get(`/api/boards/${sprint.id}/chats`, () => HttpResponse.json(chats)),
    http.get(`/api/projects/${website.id}/members`, () =>
      HttpResponse.json(members),
    ),
    http.get(`/api/projects/${website.id}/labels`, () =>
      HttpResponse.json(labels),
    ),
    http.get('/api/cards/:cardId/relatives', ({ params }) =>
      HttpResponse.json(
        relatives[String(params.cardId)] ??
          computedRelatives(String(params.cardId)),
      ),
    ),
    http.get('/api/cards/:cardId/subtasks', ({ params }) => {
      const subtasks = childrenOf(String(params.cardId))
      // A card whose subtasks this fake does not hold: a test's own handler
      // answers (a handler that gives nothing passes the request on).
      const known = anyCard(String(params.cardId))
      if (
        !known ||
        (subtasks.length === 0 && known.subtaskProgress.total > 0)
      ) {
        return undefined
      }
      return HttpResponse.json({
        subtasks: subtasks.map(listItem),
        progress: {
          complete: subtasks.filter((c) => c.isComplete).length,
          total: subtasks.length,
        },
      })
    }),
    http.post('/api/cards/:cardId/subtasks', async ({ request, params }) => {
      await record(request.clone())
      const { columnId, title } = (await request.json()) as {
        columnId: string
        title: string
      }
      const parent = anyCard(String(params.cardId))
      if (!parent) return apiError(404, 'Card not found')
      if (parent.depth >= MAX_DEPTH) {
        return apiError(
          409,
          `Subtasks can only go ${MAX_DEPTH + 1} levels deep`,
        )
      }
      const onBacklog = Object.values(backlogColumns).includes(columnId)
      const n = childrenOf(parent.id).length + 1
      const created = boardCard(`${parent.numberPath}.${n}`, title.trim(), {
        parentId: parent.id,
        boardId: onBacklog ? backlog.id : sprint.id,
        columnId,
      })
      if (onBacklog) {
        elsewhere = [...elsewhere, created]
      } else {
        view = {
          ...view,
          columns: view.columns.map((c) =>
            c.id === columnId
              ? {
                  ...c,
                  cards: [...c.cards, { ...created, position: c.cards.length }],
                }
              : c,
          ),
        }
      }
      patch(parent.id, (c) => ({
        ...c,
        subtaskProgress: { ...c.subtaskProgress, total: n },
      }))
      return HttpResponse.json(created, { status: 201 })
    }),
    http.put('/api/cards/:cardId/parent', async ({ request, params }) => {
      await record(request.clone())
      const { parentId } = (await request.json()) as { parentId: string | null }
      const refused = reparent(String(params.cardId), parentId)
      return refused ?? HttpResponse.json(anyCard(String(params.cardId)))
    }),
    http.get(`/api/projects/${website.id}/cards`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      searches.push(q)
      const words = q.trim().toLowerCase()
      const bare = words.replace(/^web-/, '')
      const found = allCards().filter(
        (c) =>
          c.numberPath === bare ||
          c.numberPath.startsWith(`${bare}.`) ||
          c.title.toLowerCase().includes(words),
      )
      return HttpResponse.json({
        cards: found
          .slice(0, 20)
          .map((c) => ({ ...related(c), depth: c.depth })),
      })
    }),
    http.get(`/api/boards/${backlog.id}`, () => {
      boardsRead.push(backlog.id)
      return HttpResponse.json(backlogView())
    }),
    http.patch('/api/cards/:cardId', async ({ request, params }) => {
      await record(request.clone())
      const body = (await request.json()) as CardChangesBody
      const cardId = String(params.cardId)
      update(cardId, (c) => applyChanges(c, body))
      return HttpResponse.json(card(cardId))
    }),
    http.put(
      '/api/cards/:cardId/assignees/:userId',
      async ({ request, params }) => {
        await record(request)
        const person = members.find((m) => m.userId === params.userId)!
        update(String(params.cardId), (c) => ({
          ...c,
          assignees: [
            ...c.assignees,
            {
              id: person.userId,
              displayName: person.displayName,
              isOwner: c.assignees.length === 0,
            },
          ],
        }))
        return HttpResponse.json([])
      },
    ),
    http.delete(
      '/api/cards/:cardId/assignees/:userId',
      async ({ request, params }) => {
        await record(request)
        update(String(params.cardId), (c) => {
          const rest = c.assignees.filter((a) => a.id !== params.userId)
          const ownerLeft = !rest.some((a) => a.isOwner)
          return {
            ...c,
            assignees: rest.map((a, i) => ({
              ...a,
              isOwner: a.isOwner || (ownerLeft && i === 0),
            })),
          }
        })
        return HttpResponse.json([])
      },
    ),
    http.put('/api/cards/:cardId/owner', async ({ request, params }) => {
      await record(request.clone())
      const { userId } = (await request.json()) as { userId: string }
      update(String(params.cardId), (c) => ({
        ...c,
        assignees: [
          ...c.assignees.filter((a) => a.id === userId),
          ...c.assignees.filter((a) => a.id !== userId),
        ].map((a) => ({ ...a, isOwner: a.id === userId })),
      }))
      return HttpResponse.json([])
    }),
    http.put(
      '/api/cards/:cardId/labels/:labelId',
      async ({ request, params }) => {
        await record(request)
        const added = labels.find((l) => l.id === params.labelId)!
        update(String(params.cardId), (c) => ({
          ...c,
          labels: [
            ...c.labels,
            { id: added.id, name: added.name, colour: added.colour },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.delete(
      '/api/cards/:cardId/labels/:labelId',
      async ({ request, params }) => {
        await record(request)
        update(String(params.cardId), (c) => ({
          ...c,
          labels: c.labels.filter((l) => l.id !== params.labelId),
        }))
        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.post(`/api/projects/${website.id}/labels`, async ({ request }) => {
      await record(request.clone())
      const body = (await request.json()) as Pick<Label, 'name' | 'colour'>
      const created = label(body.name, body.colour)
      labels = [...labels, created]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.post('/api/cards/:cardId/complete', async ({ request, params }) => {
      await record(request.clone())
      const cardId = String(params.cardId)
      const found = anyCard(cardId)!
      const done = boardOf(found.boardId).columns.find((c) => c.isDone)
      const inDone = found.columnId === done?.id
      patch(cardId, (c) => ({ ...c, isComplete: true }))
      refreshParent(found, 1)
      return HttpResponse.json({
        card: anyCard(cardId),
        doneColumnId: inDone ? null : (done?.id ?? null),
      })
    }),
    http.post('/api/cards/:cardId/reopen', async ({ request, params }) => {
      await record(request)
      const cardId = String(params.cardId)
      const found = anyCard(cardId)!
      patch(cardId, (c) => ({ ...c, isComplete: false }))
      refreshParent(found, -1)
      return HttpResponse.json(anyCard(cardId))
    }),
    http.post('/api/cards/:cardId/move', async ({ request, params }) => {
      await record(request.clone())
      const { columnId } = (await request.json()) as { columnId: string }
      const cardId = String(params.cardId)
      const moved = anyCard(cardId)!
      if (moved.boardId === backlog.id) {
        const isDone = columnId === backlogColumns.shipped
        patch(cardId, (c) => ({ ...c, columnId, isComplete: isDone }))
        return HttpResponse.json(anyCard(cardId))
      }
      view = {
        ...view,
        columns: view.columns.map((column) => ({
          ...column,
          cards:
            column.id === columnId
              ? [
                  ...column.cards.filter((c) => c.id !== cardId),
                  { ...moved, columnId, isComplete: column.isDone },
                ]
              : column.cards.filter((c) => c.id !== cardId),
        })),
      }
      return HttpResponse.json(card(cardId))
    }),
    http.delete('/api/cards/:cardId', async ({ request, params }) => {
      const cardId = String(params.cardId)
      const text = await request.clone().text()
      await record(request)
      const choices = (text ? JSON.parse(text) : {}).subtasks as
        | Record<
            string,
            { action: 'delete' | 'standalone' | 'move'; parentId?: string }
          >
        | undefined
      for (const [subtaskId, choice] of Object.entries(choices ?? {})) {
        if (choice.action === 'delete') removeCard(subtaskId)
        else reparent(subtaskId, choice.parentId ?? null)
      }
      removeCard(cardId)
      return new HttpResponse(null, { status: 204 })
    }),
  )

  // Ticking a card changes its parent's count.
  function refreshParent(child: BoardCard, by: number) {
    if (!child.parentId) return
    patch(child.parentId, (c) => ({
      ...c,
      subtaskProgress: {
        ...c.subtaskProgress,
        complete: c.subtaskProgress.complete + by,
      },
    }))
  }

  return {
    requests,
    card: (cardId: string) => anyCard(cardId),
    // The ids of boards other than this one that were loaded.
    boardsRead,
    // What was typed into the card search, one entry per request.
    searches,
  }
}

function applyChanges(card: BoardCard, body: CardChangesBody): BoardCard {
  const next = { ...card }
  if (body.title !== undefined) next.title = body.title
  if (body.description !== undefined)
    next.description = body.description === '' ? null : body.description
  if (body.priority !== undefined) next.priority = body.priority
  if (body.estimateMinutes !== undefined)
    next.estimateMinutes = body.estimateMinutes
  if (body.due !== undefined) {
    if (body.due === null) {
      next.dueAt = null
      next.dueHasTime = false
    } else if ('date' in body.due) {
      next.dueAt = `${body.due.date}T00:00:00.000Z`
      next.dueHasTime = false
    } else {
      next.dueAt = new Date(body.due.at).toISOString()
      next.dueHasTime = true
    }
  }
  return next
}
