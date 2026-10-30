import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { meKey } from '../api/auth'
import { currentPath, renderApp } from '../test/render'
import {
  ana,
  apiError,
  server,
  signedInAs,
  signUpOpen,
} from '../test/server'

describe('App frame', () => {
  it('shows who is signed in and signs out from the account menu', async () => {
    let signedOut = false
    server.use(
      signedInAs(ana),
      signUpOpen(true),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.post('/api/auth/sign-out', () => {
        signedOut = true
        server.use(signedInAs(null))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Account menu for Ana' }),
    )
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(currentPath(router)).toBe('/sign-in'))
    expect(signedOut).toBe(true)
  })

  it('opens the project list from the home address', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { router } = renderApp('/')

    await waitFor(() => expect(currentPath(router)).toBe('/projects'))
  })

  it('says when a page does not exist', async () => {
    server.use(signedInAs(ana))
    renderApp('/WEB/nothing/here')

    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })
})

describe('Ended sessions and problems', () => {
  it('sends the person to sign in when their session ends, and back afterwards', async () => {
    server.use(
      signedInAs(ana),
      signUpOpen(true),
      http.get('/api/projects', () => apiError(401, 'Not signed in')),
    )
    const { router } = renderApp('/projects')

    await waitFor(() =>
      expect(currentPath(router)).toBe('/sign-in?returnTo=%2Fprojects'),
    )
  })

  it('says when Tessera cannot be reached, instead of asking to sign in', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.error()))
    const { router } = renderApp('/projects')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tessera could not be reached',
    )
    expect(currentPath(router)).toBe('/projects')
  })

  it('keeps the page when a later reload of the signed-in person fails', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { queryClient } = renderApp('/projects')
    await screen.findByRole('heading', { name: 'Your projects' })

    server.use(http.get('/api/auth/me', () => HttpResponse.error()))
    await queryClient.refetchQueries({ queryKey: meKey }).catch(() => {})

    expect(queryClient.getQueryState(meKey)?.status).toBe('error')
    // Let the page catch up with the failed reload.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Your projects' }),
    ).toBeInTheDocument()
  })

  it('keeps the account menu open and explains when signing out fails', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.post('/api/auth/sign-out', () => apiError(500, 'Server error')),
    )
    const { router, user } = renderApp('/projects')

    await user.click(
      await screen.findByRole('button', { name: 'Account menu for Ana' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t sign out. Server error',
    )
    expect(currentPath(router)).toBe('/projects')
  })
})
