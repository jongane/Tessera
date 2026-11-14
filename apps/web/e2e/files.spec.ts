import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

// Files on cards, PR A (acceptance criterion 47): the real web app, served
// by the real API, on a real database and a real SeaweedFS (the bucket is
// TEST_S3_BUCKET). Ana attaches a PNG and a PDF; Ben, in a second window on
// the same board, sees them appear without reloading.

const PASSWORD = 'a long enough password'

// A real 1x1 PNG, so the browser can draw it.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000101a5f645400000000049454e44ae426082',
  'hex',
)
const PDF = Buffer.from('%PDF-1.4\n% a tiny pretend plan, 12345\n')

interface Person {
  page: Page
  request: APIRequestContext
}

async function twoPeopleOnOneCard(browser: Browser, baseURL: string) {
  expect(
    process.env.TEST_S3_BUCKET,
    'TEST_S3_BUCKET must name the bucket for tests (see apps/api/.env.example)',
  ).toBeTruthy()
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
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
      data: { name: `Files test ${run}`, code },
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
  const columns = (
    await (await ana.request.get(`/api/boards/${board.id}`)).json()
  ).columns as { id: string; name: string }[]
  const card = await (
    await ana.request.post(`/api/columns/${columns[0]!.id}/cards`, {
      data: { title: 'Login page' },
    })
  ).json()

  const panels: Record<string, ReturnType<Page['getByRole']>> = {}
  for (const [name, person] of [
    ['ana', ana],
    ['ben', ben],
  ] as const) {
    await person.page.goto(`/${code}/boards/${board.id}?card=${card.id}`)
    panels[name] = person.page.getByRole('complementary', {
      name: /^Card .*-\d+$/,
    })
    await expect(panels[name]!).toBeVisible()
  }
  return { ana, ben, panels, code }
}

function filesOf(panel: ReturnType<Page['getByRole']>) {
  return panel.getByRole('region', { name: 'Files' })
}

function rowOf(files: ReturnType<Page['getByRole']>, name: string) {
  return files.getByRole('listitem').filter({ hasText: name })
}

test('Ana attaches a PNG and a PDF, Ben sees them appear, Ana removes the PDF, and the Activity tab tells it', async ({
  browser,
}, testInfo) => {
  const { ana, ben, panels } = await twoPeopleOnOneCard(
    browser,
    testInfo.project.use.baseURL!,
  )
  const anaFiles = filesOf(panels.ana!)
  const benFiles = filesOf(panels.ben!)
  await expect(anaFiles).toContainText('No files yet')
  await expect(benFiles).toContainText('No files yet')

  // Ana attaches both with the "Attach file" button.
  const chooser = ana.page.waitForEvent('filechooser')
  await anaFiles.getByRole('button', { name: 'Attach file' }).click()
  await (
    await chooser
  ).setFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: PNG },
    { name: 'plan.pdf', mimeType: 'application/pdf', buffer: PDF },
  ])

  for (const files of [anaFiles, benFiles]) {
    const png = rowOf(files, 'photo.png')
    await expect(png).toBeVisible()
    await expect(png).toContainText('Added by Ana')
    await expect(png).toContainText(`${PNG.length} bytes`)
    const pdf = rowOf(files, 'plan.pdf')
    await expect(pdf).toBeVisible()
    await expect(pdf).toContainText('Added by Ana')
    await expect(pdf).toContainText(`${PDF.length} bytes`)
  }

  // The PNG shows a preview, which really loaded, and opens full size.
  const preview = rowOf(anaFiles, 'photo.png').getByRole('img', {
    name: 'photo.png',
  })
  await expect(preview).toBeVisible()
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  await rowOf(anaFiles, 'photo.png')
    .getByRole('button', { name: 'photo.png' })
    .click()
  const dialog = ana.page.getByRole('dialog', { name: 'photo.png' })
  await expect(dialog.getByRole('img', { name: 'photo.png' })).toBeVisible()
  await expectNoAccessibilityProblems(ana.page)
  await ana.page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // The PDF downloads with its own name and bytes.
  const downloading = ana.page.waitForEvent('download')
  await rowOf(anaFiles, 'plan.pdf')
    .getByRole('link', { name: /^Download/ })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('plan.pdf')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  expect(Buffer.concat(chunks)).toEqual(PDF)

  // Ana removes the PDF; it goes for both.
  await rowOf(anaFiles, 'plan.pdf')
    .getByRole('button', { name: /^Remove/ })
    .click()
  const confirm = ana.page.getByRole('dialog', { name: 'Remove ‘plan.pdf’?' })
  await expectNoAccessibilityProblems(ana.page)
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(rowOf(anaFiles, 'plan.pdf')).toHaveCount(0)
  await expect(rowOf(benFiles, 'plan.pdf')).toHaveCount(0)
  await expect(rowOf(benFiles, 'photo.png')).toBeVisible()

  // The Activity tab tells it, for both of them.
  for (const [person, panel] of [
    [ana, panels.ana!],
    [ben, panels.ben!],
  ] as const) {
    await panel.getByRole('tab', { name: 'Activity' }).click()
    const activity = panel.getByRole('list', { name: 'Activity' })
    await expect(activity).toContainText('Ana attached the file ‘photo.png’')
    await expect(activity).toContainText('Ana attached the file ‘plan.pdf’')
    await expect(activity).toContainText('Ana removed the file ‘plan.pdf’')
    await expectNoAccessibilityProblems(person.page)
  }
})

test('files dropped on the card panel are attached', async ({
  browser,
}, testInfo) => {
  const { ana, panels } = await twoPeopleOnOneCard(
    browser,
    testInfo.project.use.baseURL!,
  )
  const files = filesOf(panels.ana!)
  await expect(files).toContainText('No files yet')

  // A real drop of a real file, made in the page.
  const data = await ana.page.evaluateHandle(
    (bytes: number[]) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array(bytes)], 'dropped.pdf', {
          type: 'application/pdf',
        }),
      )
      return transfer
    },
    [...PDF],
  )
  await panels.ana!.dispatchEvent('dragenter', { dataTransfer: data })
  await expect(panels.ana!).toContainText('Drop files to attach')
  await expectNoAccessibilityProblems(ana.page)
  await panels.ana!.dispatchEvent('drop', { dataTransfer: data })

  await expect(rowOf(files, 'dropped.pdf')).toContainText('Added by Ana')
  await expect(panels.ana!).not.toContainText('Drop files to attach')
})
