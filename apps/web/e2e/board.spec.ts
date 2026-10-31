import { expect, type Page, test } from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

// Signs up someone new and opens a new board in a new project.
async function openNewBoard(page: Page) {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Ben')
  await page.getByLabel('Email').fill(`ben-${run}@example.com`)
  await page
    .getByLabel('Password', { exact: true })
    .fill('a long enough password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Create your first project' }).click()
  const project = page.getByRole('dialog', { name: 'New project' })
  await project.getByLabel('Name').fill(`Board test ${run}`)
  await expect(project.getByLabel('Code')).not.toHaveValue('')
  await project.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'Create your first board' }).click()
  const board = page.getByRole('dialog', { name: 'New board' })
  await board.getByLabel('Name').fill('Sprint 1')
  await board.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sprint 1' }),
  ).toBeVisible()
}

async function addCard(page: Page, column: string, title: string) {
  const region = page.getByRole('region', { name: column })
  await region.getByRole('button', { name: 'Add a card' }).click()
  await region.getByLabel('Card title').fill(title)
  await region.getByRole('button', { name: 'Add' }).click()
  await expect(
    region.getByRole('button', { name: new RegExp(`-\\d+ ${title}$`) }),
  ).toBeVisible()
  await region.getByRole('button', { name: 'Cancel' }).click()
}

function card(page: Page, column: string, title: string) {
  return page
    .getByRole('region', { name: column })
    .getByRole('button', { name: new RegExp(`-\\d+ ${title}$`) })
}

test('add cards and drag one to another column', async ({ page }) => {
  await openNewBoard(page)
  await addCard(page, 'To do', 'Login page')
  await addCard(page, 'To do', 'Sign-up page')
  await expectNoAccessibilityProblems(page)

  const login = card(page, 'To do', 'Login page')
  const target = page
    .getByRole('region', { name: 'In progress' })
    .getByText('No cards')
  const from = (await login.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Several steps, so the drag starts and passes over the column.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  })
  await page.mouse.up()

  await expect(card(page, 'In progress', 'Login page')).toBeVisible()
  await page.reload()
  await expect(card(page, 'In progress', 'Login page')).toBeVisible()
  await expect(card(page, 'To do', 'Sign-up page')).toBeVisible()
})

test('move a card with the keyboard', async ({ page }) => {
  await openNewBoard(page)
  await addCard(page, 'To do', 'Login page')
  await addCard(page, 'To do', 'Sign-up page')

  // Space picks the card up, the arrow keys move it, Space drops it. Each
  // step is read out, so wait for it as a screen reader user would.
  const announcement = page.getByRole('status')
  await card(page, 'To do', 'Sign-up page').focus()
  await page.keyboard.press('Space')
  await expect(announcement).toHaveText(/is in To do, place 2 of 2/)
  await page.keyboard.press('ArrowUp')
  await expect(announcement).toHaveText(/is in To do, place 1 of 2/)
  await page.keyboard.press('Space')

  const toDo = page.getByRole('region', { name: 'To do' })
  await expect(toDo.getByRole('button', { name: /^\w+-\d+ / })).toHaveText([
    /Sign-up page/,
    /Login page/,
  ])
  await page.reload()
  await expect(toDo.getByRole('button', { name: /^\w+-\d+ / })).toHaveText([
    /Sign-up page/,
    /Login page/,
  ])

  await card(page, 'To do', 'Login page').focus()
  await page.keyboard.press('Space')
  await expect(announcement).toHaveText(/is in To do, place 2 of 2/)
  await page.keyboard.press('ArrowRight')
  await expect(announcement).toHaveText(/is in In progress/)
  await page.keyboard.press('Space')
  await expect(card(page, 'In progress', 'Login page')).toBeVisible()
})

test('open a chat, dock it on the left and resize it', async ({ page }) => {
  await openNewBoard(page)

  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('link', { name: 'General' })
    .click()
  const panel = page.getByRole('complementary', { name: 'Chat: General' })
  await expect(panel).toContainText('Messages are coming soon')
  await expectNoAccessibilityProblems(page)

  await panel.getByRole('button', { name: 'Dock the panel' }).click()
  await page.getByRole('menuitemradio', { name: 'Left' }).click()
  const board = page.getByRole('heading', { level: 1, name: 'Sprint 1' })
  expect((await panel.boundingBox())!.x).toBeLessThan(
    (await board.boundingBox())!.x,
  )

  const width = (await panel.boundingBox())!.width
  await page.getByRole('separator', { name: 'Resize the chat panel' }).focus()
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight')
  }
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(width)

  await page.reload()
  await expect(panel).toBeVisible()
  expect((await panel.boundingBox())!.x).toBeLessThan(
    (await board.boundingBox())!.x,
  )
})

test('start a chat, make a card for it, then unlink and link it again', async ({
  page,
}) => {
  await openNewBoard(page)
  await page.getByRole('button', { name: 'New chat' }).click()
  const dialog = page.getByRole('dialog', { name: 'New chat' })
  await dialog.getByLabel('Title').fill('Release plan')
  await dialog.getByRole('button', { name: 'Start' }).click()

  const panel = page.getByRole('complementary', {
    name: 'Chat: Release plan',
  })
  await expect(panel).toContainText('Create a card for this chat?')
  await expectNoAccessibilityProblems(page)
  await panel.getByRole('button', { name: 'Create a card' }).click()
  await expect(card(page, 'To do', 'Release plan')).toHaveAttribute(
    'aria-current',
    'true',
  )
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/)

  await panel.getByRole('button', { name: /^Unlink from / }).click()
  await expect(panel).toContainText('Create a card for this chat?')

  await panel.getByRole('button', { name: 'Link to a card' }).click()
  const picker = page.getByRole('dialog', { name: 'Link to a card' })
  await picker.getByLabel('Find a card').fill('release')
  await picker.getByRole('button', { name: /Release plan$/ }).click()
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/)
  await page.reload()
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/)
})
