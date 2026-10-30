import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { currentPath, renderApp } from '../test/render'
import { ana, server, signedInAs, signUpOpen } from '../test/server'

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
