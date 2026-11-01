import { expect, test } from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

test('an admin adds a label and changes the time zone in project settings', async ({
  page,
}) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Cat')
  await page.getByLabel('Email').fill(`cat-${run}@example.com`)
  await page
    .getByLabel('Password', { exact: true })
    .fill('a long enough password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Create your first project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name').fill(`Settings test ${run}`)
  await expect(dialog.getByLabel('Code')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Create' }).click()

  await page.getByRole('link', { name: 'Project settings' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Project settings' }),
  ).toBeVisible()
  await expectNoAccessibilityProblems(page)

  const labels = page.getByRole('region', { name: 'Labels' })
  await labels.getByLabel('New label').fill('Bug')
  await labels.getByRole('radio', { name: 'Red' }).check()
  await labels.getByRole('button', { name: 'Add label' }).click()
  await expect(labels.getByRole('button', { name: 'Edit Bug' })).toBeVisible()

  const zone = page.getByRole('region', { name: 'Time zone' })
  await zone.getByRole('combobox', { name: 'Time zone' }).fill('Europe/London')
  await zone.getByRole('button', { name: 'Save' }).click()
  await expect(zone.getByRole('status')).toHaveText('Time zone saved.')

  // Both were saved, not just shown.
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Labels' }).getByText('Bug'),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Time zone' })
      .getByRole('combobox', { name: 'Time zone' }),
  ).toHaveValue('Europe/London')
  await expectNoAccessibilityProblems(page)
})
