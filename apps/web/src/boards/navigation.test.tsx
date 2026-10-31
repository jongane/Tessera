import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  backlog,
  boardCard,
  boardColumn,
  boardView,
  sprint,
  website,
} from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { ana, apiError, server, signedInAs } from '../test/server'

const login = boardCard('12', 'Login page')
const view = boardView([boardColumn('To do', [login])])

function fakeApi() {
  server.use(
    signedInAs(ana),
    http.get('/api/projects', () => HttpResponse.json([website])),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
    http.get(`/api/projects/${website.id}/boards`, () =>
      HttpResponse.json([backlog, sprint]),
    ),
    http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
    http.get(`/api/boards/${sprint.id}/threads`, () => HttpResponse.json([])),
  )
}

// Opens Sprint 1, so the browser remembers it, then closes it again.
async function visitSprint() {
  const visit = renderApp(`/WEB/boards/${sprint.id}`)
  await screen.findByRole('heading', { name: 'Sprint 1', level: 1 })
  visit.unmount()
}

describe('Going back to the last board used', () => {
  it('opens the last board used when a project is opened', async () => {
    fakeApi()
    await visitSprint()

    const { router } = renderApp('/WEB')

    await waitFor(() =>
      expect(currentPath(router)).toBe(`/WEB/boards/${sprint.id}`),
    )
  })

  it('lists the boards when none has been used in this browser', async () => {
    fakeApi()
    const { router } = renderApp('/WEB')

    expect(
      await screen.findByRole('link', { name: 'Backlog' }),
    ).toBeInTheDocument()
    expect(currentPath(router)).toBe('/WEB')
  })

  it('lists the boards when the last one used has gone', async () => {
    fakeApi()
    await visitSprint()
    server.use(
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json([backlog]),
      ),
    )

    const { router } = renderApp('/WEB')

    expect(
      await screen.findByRole('link', { name: 'Backlog' }),
    ).toBeInTheDocument()
    expect(currentPath(router)).toBe('/WEB')
  })

  it('lands on the last board used after signing in', async () => {
    fakeApi()
    await visitSprint()

    const { router } = renderApp('/')

    await waitFor(() =>
      expect(currentPath(router)).toBe(`/WEB/boards/${sprint.id}`),
    )
  })

  it('lands on the project list the first time', async () => {
    fakeApi()
    const { router } = renderApp('/')

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
  })
})

describe('Card addresses', () => {
  it('opens a card’s board with the card highlighted', async () => {
    fakeApi()
    server.use(
      http.get('/api/cards/by-number/WEB-12', () =>
        HttpResponse.json({ ...login, boardId: sprint.id }),
      ),
    )
    const { router } = renderApp('/WEB-12')

    const card = await screen.findByRole('button', {
      name: 'WEB-12 Login page',
    })
    expect(card).toHaveAttribute('aria-current', 'true')
    expect(currentPath(router)).toBe(
      `/WEB/boards/${sprint.id}?card=${login.id}`,
    )
  })

  it('uses the card’s current number when an old one is opened', async () => {
    fakeApi()
    server.use(
      http.get('/api/cards/by-number/OLD-3', () =>
        HttpResponse.json({ ...login, boardId: sprint.id }),
      ),
    )
    const { router } = renderApp('/OLD-3')

    await waitFor(() =>
      expect(currentPath(router)).toBe(
        `/WEB/boards/${sprint.id}?card=${login.id}`,
      ),
    )
  })

  it('says when there is no such card', async () => {
    fakeApi()
    server.use(
      http.get('/api/cards/by-number/WEB-99', () =>
        apiError(404, 'Card not found'),
      ),
    )
    renderApp('/WEB-99')

    expect(
      await screen.findByRole('heading', { name: 'Card not found' }),
    ).toBeInTheDocument()
  })
})
