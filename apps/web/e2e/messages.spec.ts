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
  await project.getByLabel('Name').fill(`Message test ${run}`)
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

// Chat messages PR, acceptance criterion 34.
test('send a message with a link in the general chat, edit it, delete it', async ({
  page,
}) => {
  await openNewBoard(page)
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('link', { name: 'General' })
    .click()
  const panel = page.getByRole('complementary', { name: 'Chat: General' })
  const messages = panel.getByRole('log', { name: 'Messages' })
  await expect(messages).toContainText('No messages yet')

  // Send a message with a web address in it.
  const box = panel.getByRole('textbox', { name: 'Message' })
  await box.click()
  await box.pressSequentially('Look at https://example.com/docs now ')
  await box.press('Enter')
  const link = messages.getByRole('link', { name: 'https://example.com/docs' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', 'https://example.com/docs')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('rel', /noreferrer/)
  await expect(messages).toContainText('Ben')
  await expect(messages).not.toContainText('No messages yet')
  await expect(box).toHaveText('')
  await expectNoAccessibilityProblems(page)

  // Edit it.
  await messages.getByRole('button', { name: 'Message options' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const editor = messages.getByRole('textbox')
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await editor.pressSequentially('Fixed words')
  await expectNoAccessibilityProblems(page)
  await messages.getByRole('button', { name: 'Save' }).click()
  await expect(messages).toContainText('Fixed words')
  await expect(messages).toContainText('(edited)')
  await expect(messages.getByRole('link')).toHaveCount(0)

  // Delete it: it stays, crossed out.
  await messages.getByRole('button', { name: 'Message options' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this message?' })
  await expectNoAccessibilityProblems(page)
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toBeHidden()
  await expect(messages.locator('del')).toHaveText('Fixed words')
  await expect(messages).toContainText('Deleted by Ben')
  await expect(
    messages.getByRole('button', { name: 'Message options' }),
  ).toHaveCount(0)
  await expectNoAccessibilityProblems(page)

  // It is still there after a reload of the page.
  await page.reload()
  await expect(
    page
      .getByRole('complementary', { name: 'Chat: General' })
      .getByRole('log', { name: 'Messages' })
      .locator('del'),
  ).toHaveText('Fixed words')
})
