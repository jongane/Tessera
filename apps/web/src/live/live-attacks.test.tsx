import { within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { live } from '../test/fake-live'
import { server } from '../test/server'

// Antagonist proof (kept as a regression test, criterion 39). docs/web-app.md
// section 6: "A signal that arrives while your own save of the same thing is
// still in flight never undoes that save."

describe('A signal during your own card save', () => {
  // 39
  it('keeps your new title shown while it is still being saved, when someone else changes the same card', async () => {
    let answer = () => {}
    const answered = new Promise<void>((resolve) => (answer = resolve))
    const { user } = openCard(login)
    server.use(
      http.patch('/api/cards/:cardId', async () => {
        await answered
        return HttpResponse.json({ ...login, title: 'My title' })
      }),
    )
    const panel = await cardPanel()
    const title = within(panel).getByLabelText('Title')
    await user.clear(title)
    await typeInto(user, title, 'My title{Enter}')
    expect(title).toHaveValue('My title')

    // Someone else changes the card's priority (a different field); the
    // server has not yet saved our title.
    await live.cardChanged(login.id)
    // Give the board's reload time to land.
    await new Promise((resolve) => setTimeout(resolve, 300))

    try {
      expect(title).toHaveValue('My title')
    } finally {
      answer()
    }
  })
})
