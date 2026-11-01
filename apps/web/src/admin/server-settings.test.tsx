import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { renderApp } from '../test/render'
import { ana, apiError, server, signedInAs, signUpOpen } from '../test/server'

const admin = { ...ana, isServerAdmin: true }

describe('Server settings', () => {
  it('lets a server admin switch sign-up off', async () => {
    let changed: unknown
    server.use(
      signedInAs(admin),
      signUpOpen(true),
      http.patch('/api/server/settings', async ({ request }) => {
        changed = await request.json()
        return HttpResponse.json({ signUpOpen: false })
      }),
    )
    const { container, user } = renderApp('/admin')

    const toggle = await screen.findByRole('switch', {
      name: 'Anyone can create an account',
    })
    expect(toggle).toBeChecked()
    await expectNoAccessibilityProblems(container)
    await user.click(toggle)

    await waitFor(() => expect(changed).toEqual({ signUpOpen: false }))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('shows why the change was refused, and keeps the switch as it was', async () => {
    server.use(
      signedInAs(admin),
      signUpOpen(false),
      http.patch('/api/server/settings', () =>
        apiError(403, 'Only a server admin can change server settings'),
      ),
    )
    const { user } = renderApp('/admin')

    const toggle = await screen.findByRole('switch', {
      name: 'Anyone can create an account',
    })
    await user.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only a server admin can change server settings',
    )
    expect(toggle).not.toBeChecked()
  })

  it('is "Page not found" for anyone else', async () => {
    server.use(signedInAs(ana))
    renderApp('/admin')

    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('is linked from the account menu for server admins only', async () => {
    server.use(
      signedInAs(admin),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Account menu for Ana' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Server settings' }),
    ).toHaveAttribute('href', '/admin')
  })

  it('has no link in the account menu for other people', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Account menu for Ana' }),
    )
    await screen.findByRole('menuitem', { name: 'Sign out' })
    expect(
      screen.queryByRole('menuitem', { name: 'Server settings' }),
    ).not.toBeInTheDocument()
  })
})
