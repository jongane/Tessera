import { expect, test } from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

// Someone new signs up, creates their first project and finds it in their
// project list.
test('sign up, create a project and see it in the list', async ({ page }) => {
  const run = Date.now().toString(36)
  const projectName = `Browser test ${run}`

  await page.goto('/')
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(
    page.getByRole('heading', { name: 'Sign in to Tessera' }),
  ).toBeVisible()
  await expectNoAccessibilityProblems(page)

  const signUpLink = page.getByRole('link', { name: 'Create an account' })
  await expect(
    signUpLink,
    'Sign-up must be open on the test database (server_settings.sign_up_open)',
  ).toBeVisible()
  await signUpLink.click()
  await page.getByLabel('Your name').fill('Ana')
  await page.getByLabel('Email').fill(`ana-${run}@example.com`)
  await page
    .getByLabel('Password', { exact: true })
    .fill('a long enough password')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/projects$/)
  await page.getByRole('button', { name: 'Create your first project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name').fill(projectName)
  await expect(dialog.getByLabel('Code')).not.toHaveValue('')
  const code = await dialog.getByLabel('Code').inputValue()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(new RegExp(`/${code}$`))
  await expect(
    page.getByRole('heading', { level: 1, name: projectName }),
  ).toBeVisible()
  await expectNoAccessibilityProblems(page)

  await page.getByRole('link', { name: 'Your projects' }).click()
  await expect(
    page.getByRole('link', { name: new RegExp(projectName) }),
  ).toBeVisible()
})
