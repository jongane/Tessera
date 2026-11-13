import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

// Live updates PR (acceptance criterion 32): two people, in two browser
// windows (two contexts, so two sessions), on the same board.

const PASSWORD = 'a long enough password'

interface Person {
  page: Page
  request: APIRequestContext
}

// Ana and Ben, signed up and signed in in their own windows, with Ben a
// member of Ana's new project and both looking at Ana's board, which has the
// card "Login page" in "To do".
async function twoPeopleOnOneBoard(browser: Browser, baseURL: string) {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  // A project code is 2 to 6 letters, and each test needs its own.
  const code = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('')
  async function personNamed(name: string): Promise<Person> {
    const context = await browser.newContext({ baseURL })
    const signUp = await context.request.post('/api/auth/sign-up', {
      data: {
        email: `${name.toLowerCase()}-${run}@example.com`,
        displayName: name,
        password: PASSWORD,
      },
    })
    expect(signUp.ok()).toBe(true)
    return { page: await context.newPage(), request: context.request }
  }
  const ana = await personNamed('Ana')
  const ben = await personNamed('Ben')

  const project = await (
    await ana.request.post('/api/projects', {
      data: { name: `Live test ${run}`, code },
    })
  ).json()
  expect(
    (
      await ana.request.post(`/api/projects/${project.id}/members`, {
        data: { email: `ben-${run}@example.com` },
      })
    ).ok(),
  ).toBe(true)
  const board = await (
    await ana.request.post(`/api/projects/${project.id}/boards`, {
      data: { name: 'Sprint 1' },
    })
  ).json()
  const columns = (await (await ana.request.get(`/api/boards/${board.id}`)).json())
    .columns as { id: string; name: string }[]
  const toDo = columns.find((c) => c.name === 'To do')!
  expect(
    (
      await ana.request.post(`/api/columns/${toDo.id}/cards`, {
        data: { title: 'Login page' },
      })
    ).ok(),
  ).toBe(true)

  for (const person of [ana, ben]) {
    await person.page.goto(`/${code}/boards/${board.id}`)
    await expect(
      person.page.getByRole('heading', { level: 1, name: 'Sprint 1' }),
    ).toBeVisible()
  }
  return { ana, ben, board }
}

function card(page: Page, column: string, title: string) {
  return page
    .getByRole('region', { name: column })
    .getByRole('button', { name: new RegExp(`-\\d+ ${title}$`) })
}

async function openGeneralChat(page: Page) {
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('link', { name: 'General' })
    .click()
  return page.getByRole('complementary', { name: 'Chat: General' })
}

test('one person sends a message and moves a card, and the other sees both without reloading', async ({
  browser,
}, testInfo) => {
  const { ana, ben } = await twoPeopleOnOneBoard(
    browser,
    testInfo.project.use.baseURL!,
  )
  const anaChat = await openGeneralChat(ana.page)
  const benChat = await openGeneralChat(ben.page)
  await expect(benChat).toContainText('No messages yet')

  // Ana sends a message.
  const box = anaChat.getByRole('textbox', { name: 'Message' })
  await box.click()
  await box.pressSequentially('Hello Ben, the login page is next ')
  await box.press('Enter')
  await expect(
    benChat.getByRole('log', { name: 'Messages' }),
  ).toContainText('Hello Ben, the login page is next')

  // Ana drags the card to "In progress".
  const login = card(ana.page, 'To do', 'Login page')
  const target = ana.page
    .getByRole('region', { name: 'In progress' })
    .getByText('No cards')
  const from = (await login.boundingBox())!
  const to = (await target.boundingBox())!
  await ana.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await ana.page.mouse.down()
  await ana.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  })
  await ana.page.mouse.up()
  await expect(card(ana.page, 'In progress', 'Login page')).toBeVisible()

  // Ben sees the card in its new column, and has not reloaded.
  await expect(card(ben.page, 'In progress', 'Login page')).toBeVisible()
  await expect(card(ben.page, 'To do', 'Login page')).toHaveCount(0)
  await expectNoAccessibilityProblems(ben.page)
})

test('a person editing the description sees the other one’s change in a panel', async ({
  browser,
}, testInfo) => {
  const { ana, ben } = await twoPeopleOnOneBoard(
    browser,
    testInfo.project.use.baseURL!,
  )
  const panels: Record<string, ReturnType<Page['getByRole']>> = {}
  for (const [name, { page }] of Object.entries({ ana, ben })) {
    await card(page, 'To do', 'Login page').click()
    panels[name] = page.getByRole('complementary', { name: /^Card / })
    await expect(panels[name]!).toBeVisible()
    await panels[name]!.getByRole('button', { name: 'Edit description' }).click()
  }

  // Ben starts writing; Ana writes and saves hers.
  const benBox = panels.ben!.getByRole('textbox', { name: 'Description' })
  await benBox.click()
  await benBox.pressSequentially('Ben’s draft')
  const anaBox = panels.ana!.getByRole('textbox', { name: 'Description' })
  await anaBox.click()
  await anaBox.pressSequentially('Ana’s version')
  await panels.ana!.getByRole('button', { name: 'Save' }).click()

  // Ben keeps his words and is told, with Ana’s version shown.
  await expect(panels.ben!).toContainText(
    'Someone changed this while you were editing',
  )
  await expect(panels.ben!).toContainText('Ana’s version')
  await expect(benBox).toContainText('Ben’s draft')
  await expectNoAccessibilityProblems(ben.page)

  // Use theirs puts Ana’s version in his box.
  await panels.ben!.getByRole('button', { name: 'Use theirs' }).click()
  await expect(benBox).toContainText('Ana’s version')
  await expect(benBox).not.toContainText('Ben’s draft')
})

test('shows “Reconnecting…” while offline, then catches up when the connection is back', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const { ana, ben } = await twoPeopleOnOneBoard(
    browser,
    testInfo.project.use.baseURL!,
  )
  const anaChat = await openGeneralChat(ana.page)
  const benChat = await openGeneralChat(ben.page)
  await expect(benChat).toContainText('No messages yet')

  await ben.page.context().setOffline(true)
  await expect(ben.page.getByText('Reconnecting…')).toBeVisible({
    timeout: 60_000,
  })
  await expectNoAccessibilityProblems(ben.page)

  // Ana writes while Ben is offline.
  const box = anaChat.getByRole('textbox', { name: 'Message' })
  await box.click()
  await box.pressSequentially('Sent while you were away ')
  await box.press('Enter')
  await expect(anaChat.getByRole('log', { name: 'Messages' })).toContainText(
    'Sent while you were away',
  )

  await ben.page.context().setOffline(false)
  await expect(ben.page.getByText('Reconnecting…')).toBeHidden({
    timeout: 30_000,
  })
  await expect(benChat.getByRole('log', { name: 'Messages' })).toContainText(
    'Sent while you were away',
  )
})
