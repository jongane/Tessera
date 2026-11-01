import type { Label, Me, ProjectMember } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { lastBoardIn, lastBoardPath, rememberBoard } from '../boards/last-board'
import { sprint, website } from '../test/fixtures'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { currentPath, renderApp } from '../test/render'
import { ana, apiError, server, signedInAs } from '../test/server'

const ben: Me = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ben@example.com',
  displayName: 'Ben',
  isServerAdmin: false,
}

function member(person: Me, role: ProjectMember['role']): ProjectMember {
  return {
    userId: person.id,
    displayName: person.displayName,
    email: person.email,
    role,
    joinedAt: '2026-10-30T09:00:00.000Z',
  }
}

function label(name: string, colour: Label['colour']): Label {
  return {
    id: `label-${name}`,
    projectId: website.id,
    name,
    colour,
    createdAt: '2026-10-30T09:00:00.000Z',
  }
}

const bug = label('Bug', 'RED')

// The fake API for the settings page: the project, its members and labels.
function settingsApi({
  me = ana,
  members = [member(ana, 'ADMIN'), member(ben, 'MEMBER')],
  labels = [bug],
}: { me?: Me; members?: ProjectMember[]; labels?: Label[] } = {}) {
  server.use(
    signedInAs(me),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
    http.get(`/api/projects/${website.id}/members`, () =>
      HttpResponse.json(members),
    ),
    http.get(`/api/projects/${website.id}/labels`, () =>
      HttpResponse.json(labels),
    ),
  )
}

function section(name: string) {
  return screen.getByRole('region', { name })
}

beforeEach(() => localStorage.clear())

describe('Project settings', () => {
  it('shows the four sections, with no accessibility problems', async () => {
    settingsApi()
    const { container } = renderApp('/WEB/settings')

    expect(
      await screen.findByRole('heading', { name: 'Project settings' }),
    ).toBeInTheDocument()
    await screen.findByText('ben@example.com')
    for (const name of ['Members', 'Labels', 'Project code', 'Time zone']) {
      expect(section(name)).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      '/WEB',
    )
    await expectNoAccessibilityProblems(container)
  })

  it('says so when the project is not found', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects/by-code/NOPE', () =>
        apiError(404, 'Project not found'),
      ),
    )
    renderApp('/NOPE/settings')

    expect(
      await screen.findByRole('heading', { name: 'Project not found' }),
    ).toBeInTheDocument()
  })

  it('is linked from the project page', async () => {
    settingsApi()
    server.use(
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json([sprint]),
      ),
    )
    renderApp('/WEB')

    expect(
      await screen.findByRole('link', { name: 'Project settings' }),
    ).toHaveAttribute('href', '/WEB/settings')
  })
})

describe('Project settings: members', () => {
  it('lists everyone with their role', async () => {
    settingsApi()
    renderApp('/WEB/settings')

    const ana = await screen.findByRole('listitem', { name: /Ana/ })
    expect(within(ana).getByText('ana@example.com')).toBeInTheDocument()
    const benRow = screen.getByRole('listitem', { name: /Ben/ })
    expect(
      within(benRow).getByRole('combobox', { name: 'Role for Ben' }),
    ).toHaveValue('MEMBER')
  })

  it('lets an admin add someone by email', async () => {
    let added: unknown
    settingsApi({ members: [member(ana, 'ADMIN')] })
    server.use(
      http.post(`/api/projects/${website.id}/members`, async ({ request }) => {
        added = await request.json()
        return HttpResponse.json(member(ben, 'ADMIN'), { status: 201 })
      }),
    )
    const { user } = renderApp('/WEB/settings')

    const members = await screen.findByRole('region', { name: 'Members' })
    await user.type(
      within(members).getByRole('textbox', { name: 'Email' }),
      'ben@example.com',
    )
    await user.selectOptions(
      within(members).getByRole('combobox', { name: 'Role' }),
      'ADMIN',
    )
    await user.click(within(members).getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(added).toEqual({ email: 'ben@example.com', role: 'ADMIN' }),
    )
  })

  it('explains when nobody has an account with that email', async () => {
    settingsApi()
    server.use(
      http.post(`/api/projects/${website.id}/members`, () =>
        apiError(404, 'No account uses that email address'),
      ),
    )
    const { user } = renderApp('/WEB/settings')

    const members = await screen.findByRole('region', { name: 'Members' })
    await user.type(
      within(members).getByRole('textbox', { name: 'Email' }),
      'zoe@example.com',
    )
    await user.click(within(members).getByRole('button', { name: 'Add' }))

    expect(await within(members).findByRole('alert')).toHaveTextContent(
      'No one has an account with that email yet. Email invites come later.',
    )
  })

  it('checks the email before sending it', async () => {
    settingsApi()
    const { user } = renderApp('/WEB/settings')

    const members = await screen.findByRole('region', { name: 'Members' })
    await user.type(
      within(members).getByRole('textbox', { name: 'Email' }),
      'not an email',
    )
    await user.click(within(members).getByRole('button', { name: 'Add' }))

    expect(
      within(members).getByRole('textbox', { name: 'Email' }),
    ).toHaveAccessibleDescription(/email/i)
  })

  it('lets an admin change a role', async () => {
    let changed: unknown
    settingsApi()
    server.use(
      http.patch(
        `/api/projects/${website.id}/members/${ben.id}`,
        async ({ request }) => {
          changed = await request.json()
          return HttpResponse.json(member(ben, 'ADMIN'))
        },
      ),
    )
    const { user } = renderApp('/WEB/settings')

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for Ben' }),
      'ADMIN',
    )

    await waitFor(() => expect(changed).toEqual({ role: 'ADMIN' }))
  })

  it('asks before an admin removes someone', async () => {
    let removed = false
    settingsApi()
    server.use(
      http.delete(`/api/projects/${website.id}/members/${ben.id}`, () => {
        removed = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderApp('/WEB/settings')

    await user.click(await screen.findByRole('button', { name: 'Remove Ben' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Remove Ben from Website?',
    })
    expect(dialog).toHaveTextContent('Their card assignments go')
    expect(removed).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(removed).toBe(true))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('keeps the last admin: their role and leaving are turned off, with the reason', async () => {
    settingsApi()
    renderApp('/WEB/settings')

    const role = await screen.findByRole('combobox', { name: 'Role for Ana' })
    expect(role).toBeDisabled()
    expect(role).toHaveAccessibleDescription(
      'A project needs at least one admin.',
    )
    expect(screen.getByRole('button', { name: 'Leave project' })).toBeDisabled()
  })

  it('shows the reason when the API refuses a change', async () => {
    settingsApi({
      members: [member(ana, 'ADMIN'), member(ben, 'ADMIN')],
    })
    server.use(
      http.patch(`/api/projects/${website.id}/members/${ben.id}`, () =>
        apiError(409, 'A project needs at least one admin.'),
      ),
    )
    const { user } = renderApp('/WEB/settings')

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for Ben' }),
      'MEMBER',
    )

    expect(
      await within(section('Members')).findByRole('alert'),
    ).toHaveTextContent('A project needs at least one admin.')
  })

  it('shows a plain member the list without admin controls, and lets them leave', async () => {
    let left = false
    rememberBoard('WEB', sprint.id)
    settingsApi({ me: ben })
    server.use(
      http.delete(`/api/projects/${website.id}/members/${ben.id}`, () => {
        left = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { router, user } = renderApp('/WEB/settings')

    const members = await screen.findByRole('region', { name: 'Members' })
    await within(members).findByText('ana@example.com')
    expect(within(members).queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      within(members).queryByRole('button', { name: /Remove/ }),
    ).not.toBeInTheDocument()
    expect(
      within(members).queryByRole('textbox', { name: 'Email' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Leave project' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave Website?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
    expect(left).toBe(true)
    expect(lastBoardIn('WEB')).toBeUndefined()
    expect(lastBoardPath()).toBeUndefined()
  })
})

describe('Project settings: labels', () => {
  it('lists the labels', async () => {
    settingsApi({ labels: [bug, label('Design', 'BLUE')] })
    renderApp('/WEB/settings')

    const labels = await screen.findByRole('region', { name: 'Labels' })
    expect(await within(labels).findByText('Bug')).toBeInTheDocument()
    expect(within(labels).getByText('Design')).toBeInTheDocument()
  })

  it('lets any member add a label with a colour', async () => {
    let created: unknown
    settingsApi({ me: ben })
    server.use(
      http.post(`/api/projects/${website.id}/labels`, async ({ request }) => {
        created = await request.json()
        return HttpResponse.json(label('Docs', 'GREEN'), { status: 201 })
      }),
    )
    const { user } = renderApp('/WEB/settings')

    const labels = await screen.findByRole('region', { name: 'Labels' })
    await user.type(
      within(labels).getByRole('textbox', { name: 'New label' }),
      'Docs',
    )
    await user.click(within(labels).getByRole('radio', { name: 'Green' }))
    await user.click(within(labels).getByRole('button', { name: 'Add label' }))

    await waitFor(() =>
      expect(created).toEqual({ name: 'Docs', colour: 'GREEN' }),
    )
  })

  it('only lets admins edit and delete labels', async () => {
    settingsApi({ me: ben })
    renderApp('/WEB/settings')

    const labels = await screen.findByRole('region', { name: 'Labels' })
    await within(labels).findByText('Bug')
    expect(
      within(labels).queryByRole('button', { name: 'Edit Bug' }),
    ).not.toBeInTheDocument()
    expect(
      within(labels).queryByRole('button', { name: 'Delete Bug' }),
    ).not.toBeInTheDocument()
  })

  it('lets an admin rename and recolour a label', async () => {
    let changed: unknown
    settingsApi()
    server.use(
      http.patch(`/api/labels/${bug.id}`, async ({ request }) => {
        changed = await request.json()
        return HttpResponse.json(label('Defect', 'ORANGE'))
      }),
    )
    const { user } = renderApp('/WEB/settings')

    await user.click(await screen.findByRole('button', { name: 'Edit Bug' }))
    const form = screen.getByRole('form', { name: 'Edit Bug' })
    const name = within(form).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Defect')
    await user.click(within(form).getByRole('radio', { name: 'Orange' }))
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(changed).toEqual({ name: 'Defect', colour: 'ORANGE' }),
    )
  })

  it('asks before an admin deletes a label', async () => {
    let deleted = false
    settingsApi()
    server.use(
      http.delete(`/api/labels/${bug.id}`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderApp('/WEB/settings')

    await user.click(await screen.findByRole('button', { name: 'Delete Bug' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Delete the label Bug?',
    })
    expect(dialog).toHaveTextContent('It comes off every card that has it.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleted).toBe(true))
  })

  it('shows why a label could not be added', async () => {
    settingsApi()
    server.use(
      http.post(`/api/projects/${website.id}/labels`, () =>
        apiError(409, 'A label called Bug already exists'),
      ),
    )
    const { user } = renderApp('/WEB/settings')

    const labels = await screen.findByRole('region', { name: 'Labels' })
    await user.type(
      within(labels).getByRole('textbox', { name: 'New label' }),
      'bug',
    )
    await user.click(within(labels).getByRole('button', { name: 'Add label' }))

    expect(await within(labels).findByRole('alert')).toHaveTextContent(
      'A label called Bug already exists',
    )
  })
})

describe('Project settings: project code', () => {
  it('lets an admin change the code, after explaining old numbers keep working', async () => {
    let changed: unknown
    rememberBoard('WEB', sprint.id)
    settingsApi()
    server.use(
      http.patch(`/api/projects/${website.id}`, async ({ request }) => {
        changed = await request.json()
        return HttpResponse.json({ ...website, code: 'SITE' })
      }),
      http.get('/api/projects/by-code/SITE', () =>
        HttpResponse.json({ ...website, code: 'SITE' }),
      ),
    )
    const { router, user } = renderApp('/WEB/settings')

    const code = await screen.findByRole('region', { name: 'Project code' })
    await user.click(within(code).getByRole('button', { name: 'Change code' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Change the project code?',
    })
    expect(dialog).toHaveTextContent('WEB-12 keep working')
    const field = within(dialog).getByRole('textbox', { name: 'New code' })
    await user.clear(field)
    await user.type(field, 'site')
    await user.click(
      within(dialog).getByRole('button', { name: 'Change code' }),
    )

    await waitFor(() => expect(currentPath(router)).toBe('/SITE/settings'))
    expect(changed).toEqual({ code: 'SITE' })
    expect(lastBoardIn('SITE')).toBe(sprint.id)
    expect(lastBoardPath()).toBe(`/SITE/boards/${sprint.id}`)
  })

  it('shows why a code was refused', async () => {
    settingsApi()
    server.use(
      http.patch(`/api/projects/${website.id}`, () =>
        apiError(409, 'The project code APP is already in use'),
      ),
    )
    const { user } = renderApp('/WEB/settings')

    await user.click(await screen.findByRole('button', { name: 'Change code' }))
    const dialog = screen.getByRole('dialog')
    const field = within(dialog).getByRole('textbox', { name: 'New code' })
    await user.clear(field)
    await user.type(field, 'APP')
    await user.click(
      within(dialog).getByRole('button', { name: 'Change code' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The project code APP is already in use',
    )
  })

  it('shows a plain member the code without a way to change it', async () => {
    settingsApi({ me: ben })
    renderApp('/WEB/settings')

    const code = await screen.findByRole('region', { name: 'Project code' })
    expect(within(code).getByText('WEB')).toBeInTheDocument()
    await screen.findByText('ben@example.com')
    expect(
      within(code).queryByRole('button', { name: 'Change code' }),
    ).not.toBeInTheDocument()
  })
})

describe('Project settings: time zone', () => {
  it('lets an admin pick a new time zone', async () => {
    let changed: unknown
    settingsApi()
    server.use(
      http.patch(`/api/projects/${website.id}`, async ({ request }) => {
        changed = await request.json()
        return HttpResponse.json({ ...website, timeZone: 'Europe/London' })
      }),
    )
    const { user } = renderApp('/WEB/settings')

    const zone = await screen.findByRole('region', { name: 'Time zone' })
    const field = await within(zone).findByRole('combobox', {
      name: 'Time zone',
    })
    expect(field).toHaveValue('UTC')
    await user.clear(field)
    await user.type(field, 'Europe/London')
    await user.click(within(zone).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(changed).toEqual({ timeZone: 'Europe/London' }))
  })

  it('refuses a time zone it does not know', async () => {
    settingsApi()
    const { user } = renderApp('/WEB/settings')

    const zone = await screen.findByRole('region', { name: 'Time zone' })
    const field = await within(zone).findByRole('combobox', {
      name: 'Time zone',
    })
    await user.clear(field)
    await user.type(field, 'Mars/Base')
    await user.click(within(zone).getByRole('button', { name: 'Save' }))

    expect(field).toHaveAccessibleDescription(/Unknown time zone/)
  })

  it('shows a plain member the time zone without a way to change it', async () => {
    settingsApi({ me: ben })
    renderApp('/WEB/settings')

    const zone = await screen.findByRole('region', { name: 'Time zone' })
    await screen.findByText('ben@example.com')
    expect(within(zone).getByText('UTC')).toBeInTheDocument()
    expect(within(zone).queryByRole('combobox')).not.toBeInTheDocument()
  })
})
