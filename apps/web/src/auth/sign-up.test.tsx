import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { currentPath, renderApp } from '../test/render'
import {
  ana,
  apiError,
  server,
  signedInAs,
  signUpOpen,
} from '../test/server'

describe('Sign up', () => {
  it('creates an account and opens the project list', async () => {
    server.use(
      signedInAs(null),
      signUpOpen(true),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.post('/api/auth/sign-up', () => {
        server.use(signedInAs(ana))
        return HttpResponse.json(ana, { status: 201 })
      }),
    )
    const { container, router, user } = renderApp('/sign-up')

    await user.type(await screen.findByLabelText('Your name'), 'Ana')
    await user.type(screen.getByLabelText('Email'), 'ana@example.com')
    await user.type(screen.getByLabelText('Password'), 'long enough pass')
    await expectNoAccessibilityProblems(container)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
  })

  it('explains the password rule before asking the API', async () => {
    server.use(signedInAs(null), signUpOpen(true))
    const { user } = renderApp('/sign-up')

    await user.type(await screen.findByLabelText('Your name'), 'Ana')
    await user.type(screen.getByLabelText('Email'), 'ana@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(
      await screen.findByText('A password must be at least 10 characters'),
    ).toBeInTheDocument()
  })

  it('shows the API’s message when the email is taken', async () => {
    server.use(
      signedInAs(null),
      signUpOpen(true),
      http.post('/api/auth/sign-up', () =>
        apiError(409, 'An account with that email already exists'),
      ),
    )
    const { user } = renderApp('/sign-up')

    await user.type(await screen.findByLabelText('Your name'), 'Ana')
    await user.type(screen.getByLabelText('Email'), 'ana@example.com')
    await user.type(screen.getByLabelText('Password'), 'long enough pass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with that email already exists',
    )
  })

  it('says sign-up is closed when a server admin has switched it off', async () => {
    server.use(signedInAs(null), signUpOpen(false))
    renderApp('/sign-up')

    expect(
      await screen.findByText(
        'Sign-up is closed. Ask your server admin for an account.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })
})
