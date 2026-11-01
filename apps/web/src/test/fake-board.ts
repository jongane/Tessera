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
} from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { backlog, sprint, website } from './fixtures'
import { ana, server, signedInAs } from './server'

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
  }: FakeBoardOptions = {},
) {
  let view = structuredClone(start)
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

  server.use(
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
        relatives[String(params.cardId)] ?? {
          parents: [],
          subtasks: [],
          siblings: [],
        },
      ),
    ),
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
      const done = view.columns.find((column) => column.isDone)
      const inDone = done?.cards.some((c) => c.id === cardId) ?? false
      update(cardId, (c) => ({ ...c, isComplete: true }))
      return HttpResponse.json({
        card: card(cardId),
        doneColumnId: inDone ? null : (done?.id ?? null),
      })
    }),
    http.post('/api/cards/:cardId/reopen', async ({ request, params }) => {
      await record(request)
      const cardId = String(params.cardId)
      update(cardId, (c) => ({ ...c, isComplete: false }))
      return HttpResponse.json(card(cardId))
    }),
    http.post('/api/cards/:cardId/move', async ({ request, params }) => {
      await record(request.clone())
      const { columnId } = (await request.json()) as { columnId: string }
      const cardId = String(params.cardId)
      const moved = card(cardId)!
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
      await record(request)
      const cardId = String(params.cardId)
      view = {
        ...view,
        columns: view.columns.map((column) => ({
          ...column,
          cards: column.cards.filter((c) => c.id !== cardId),
        })),
      }
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return {
    requests,
    card: (cardId: string) => card(cardId),
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
