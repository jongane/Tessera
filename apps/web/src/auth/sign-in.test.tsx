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

function signedOut() {
  server.use(
    signedInAs(null),
    signUpOpen(true),
    http.get('/api/projects', () => HttpResponse.json([])),
  )
}

describe('Sign in', () => {
  it('shows the sign-in form with no accessibility problems', async () => {
    signedOut()
    const { container } = renderApp('/sign-in')

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Tessera' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  it('signs in and opens the page the person asked for', async () => {
    signedOut()
    let sent: unknown
    server.use(
      http.post('/api/auth/sign-in', async ({ request }) => {
        sent = await request.json()
        server.use(signedInAs(ana))
        return HttpResponse.json(ana)
      }),
    )
    const { router, user } = renderApp('/sign-in?returnTo=%2Fprojects')

    await user.type(await screen.findByLabelText('Email'), ' Ana@Example.com ')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
    expect(sent).toEqual({
      email: 'ana@example.com',
      password: 'correct horse',
    })
  })

  it('says what is wrong with the email before asking the API', async () => {
    signedOut()
    const { user } = renderApp('/sign-in')

    await user.type(await screen.findByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'anything')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument()
  })

  it('shows the API’s message when the password is wrong', async () => {
    signedOut()
    server.use(
      http.post('/api/auth/sign-in', () =>
        apiError(401, 'That email and password do not match'),
      ),
    )
    const { user } = renderApp('/sign-in')

    await user.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match',
    )
  })

  it('shows and hides the password', async () => {
    signedOut()
    const { user } = renderApp('/sign-in')
    const password = await screen.findByLabelText('Password')

    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
  })

  it('offers sign-up only while it is open', async () => {
    signedOut()
    renderApp('/sign-in')
    expect(
      await screen.findByRole('link', { name: 'Create an account' }),
    ).toBeInTheDocument()
  })

  it('hides the sign-up link when sign-up is switched off', async () => {
    server.use(signedInAs(null), signUpOpen(false))
    renderApp('/sign-in')

    await screen.findByRole('heading', { name: 'Sign in to Tessera' })
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Create an account' }),
      ).not.toBeInTheDocument(),
    )
  })
})

describe('Already signed in', () => {
  it('goes straight on from the sign-in page', async () => {
    server.use(
      signedInAs(ana),
      signUpOpen(true),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { router } = renderApp('/sign-in?returnTo=%2Fprojects')

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
  })

  it('goes straight to the project list from the sign-up page', async () => {
    server.use(
      signedInAs(ana),
      signUpOpen(true),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { router } = renderApp('/sign-up')

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
  })
})
