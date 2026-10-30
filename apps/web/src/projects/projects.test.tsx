import type { Board, Project } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { currentPath, renderApp } from '../test/render'
import { ana, apiError, server, signedInAs } from '../test/server'

const website: Project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Website',
  description: 'The public site',
  code: 'WEB',
  timeZone: 'UTC',
  createdAt: '2026-10-30T09:00:00.000Z',
}

const sprint: Board = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: website.id,
  name: 'Sprint 1',
  createdAt: '2026-10-30T09:00:00.000Z',
}

describe('Project list', () => {
  it('sends someone who is not signed in to sign in, and back afterwards', async () => {
    server.use(
      signedInAs(null),
      http.get('/api/server/settings', () =>
        HttpResponse.json({ signUpOpen: true }),
      ),
    )
    const { router } = renderApp('/projects')

    await waitFor(() =>
      expect(currentPath(router)).toBe('/sign-in?returnTo=%2Fprojects'),
    )
  })

  it('offers to create the first project when there are none', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { container } = renderApp('/projects')

    expect(
      await screen.findByRole('button', { name: 'Create your first project' }),
    ).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  it('lists projects, each linking to its page', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([website])),
    )
    renderApp('/projects')

    const link = await screen.findByRole('link', { name: /Website/ })
    expect(link).toHaveAttribute('href', '/WEB')
    expect(within(link).getByText('WEB')).toBeInTheDocument()
  })

  it('creates a project with a code suggested from its name', async () => {
    let created: unknown
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.get('/api/projects/suggest-code', ({ request }) => {
        const name = new URL(request.url).searchParams.get('name')
        return HttpResponse.json({ code: name === 'Website' ? 'WEB' : 'XX' })
      }),
      http.post('/api/projects', async ({ request }) => {
        created = await request.json()
        return HttpResponse.json(website, { status: 201 })
      }),
      http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json([]),
      ),
    )
    const { router, user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Create your first project' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await user.type(within(dialog).getByLabelText('Name'), 'Website')
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Code')).toHaveValue('WEB'),
    )
    await expectNoAccessibilityProblems(dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(currentPath(router)).toBe('/WEB'))
    expect(created).toEqual({ name: 'Website', code: 'WEB' })
  })

  it('keeps the dialog open with the API’s message when the code is taken', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.get('/api/projects/suggest-code', () =>
        HttpResponse.json({ code: 'WEB' }),
      ),
      http.post('/api/projects', () =>
        apiError(409, 'The code WEB is already used by another project'),
      ),
    )
    const { user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Create your first project' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await user.type(within(dialog).getByLabelText('Name'), 'Website')
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Code')).toHaveValue('WEB'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The code WEB is already used by another project',
    )
  })
})

describe('Project page', () => {
  function project(boards: Board[]) {
    server.use(
      signedInAs(ana),
      http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json(boards),
      ),
    )
  }

  it('lists the project’s boards', async () => {
    project([sprint])
    const { container } = renderApp('/WEB')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Website' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: 'Sprint 1' }),
    ).toHaveAttribute('href', `/WEB/boards/${sprint.id}`)
    await expectNoAccessibilityProblems(container)
  })

  it('creates the first board', async () => {
    project([])
    server.use(
      http.post(`/api/projects/${website.id}/boards`, () => {
        project([sprint])
        return HttpResponse.json(sprint, { status: 201 })
      }),
    )
    const { router, user } = renderApp('/WEB')

    await user.click(
      await screen.findByRole('button', { name: 'Create your first board' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'New board' })
    await user.type(within(dialog).getByLabelText('Name'), 'Sprint 1')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(currentPath(router)).toBe(`/WEB/boards/${sprint.id}`),
    )
  })

  it('says when there is no such project', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects/by-code/NOPE', () =>
        apiError(404, 'Project not found'),
      ),
    )
    renderApp('/NOPE')

    expect(
      await screen.findByRole('heading', { name: 'Project not found' }),
    ).toBeInTheDocument()
  })
})

describe('New project code', () => {
  it('brings the suggestion back when the code is left empty', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.get('/api/projects/suggest-code', () =>
        HttpResponse.json({ code: 'WEB' }),
      ),
    )
    const { user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Create your first project' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await user.type(within(dialog).getByLabelText('Name'), 'Website')
    const code = within(dialog).getByLabelText('Code')
    await waitFor(() => expect(code).toHaveValue('WEB'))
    await user.clear(code)
    await user.type(code, 'site')
    expect(code).toHaveValue('SITE')
    await user.clear(code)
    expect(code).toHaveValue('')
    await user.tab()

    await waitFor(() => expect(code).toHaveValue('WEB'))
  })
})
