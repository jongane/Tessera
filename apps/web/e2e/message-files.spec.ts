import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import { expectNoAccessibilityProblems } from './accessibility'

// Files on messages, PR B (acceptance criterion 38): the real web app, served
// by the real API, on a real database and a real SeaweedFS (the bucket is
// TEST_S3_BUCKET). Ana attaches a PDF with "Attach file" and pastes a PNG
// into a card's chat; Ben, in a second window, sees the message with both
// files without reloading.

const PASSWORD = 'a long enough password'

// A real 1x1 PNG, so the browser can draw it.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000101a5f645400000000049454e44ae426082',
  'hex',
)
const PDF = Buffer.from('%PDF-1.4\n% a tiny pretend plan, 67890\n')
// The same name, found inside a longer text (a list item also holds "from chat").
const SCREENSHOT_IN_TEXT = /Screenshot \d{4}-\d\d-\d\d \d\d\.\d\d\.png/
const SCREENSHOT = /^Screenshot \d{4}-\d\d-\d\d \d\d\.\d\d\.png$/

interface Person {
  page: Page
  request: APIRequestContext
}

async function twoPeopleInACardChat(browser: Browser, baseURL: string) {
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
      data: { name: `Message files test ${run}`, code },
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
  ).columns as { id: string }[]
  const card = await (
    await ana.request.post(`/api/columns/${columns[0]!.id}/cards`, {
      data: { title: 'Login page' },
    })
  ).json()
  const chat = (await (await ana.request.get(`/api/cards/${card.id}`)).json())
    .chat as { id: string; title: string }

  const panels: Record<string, { card: Locator; chat: Locator }> = {}
  for (const [name, person] of [
    ['ana', ana],
    ['ben', ben],
  ] as const) {
    await person.page.goto(
      `/${code}/boards/${board.id}?card=${card.id}&chat=${chat.id}`,
    )
    panels[name] = {
      card: person.page.getByRole('complementary', { name: /^Card .*-\d+$/ }),
      chat: person.page.getByRole('complementary', {
        name: `Chat: ${chat.title}`,
      }),
    }
    await expect(panels[name]!.card).toBeVisible()
    await expect(panels[name]!.chat).toBeVisible()
  }
  return { ana, ben, panels }
}

function messageOf(chat: Locator, text: string) {
  return chat
    .getByRole('log', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: text })
}

test('Ana sends a PDF and a pasted PNG in a card’s chat, Ben sees them live, the card lists them "from chat", Ana removes one and deletes the message', async ({
  browser,
}, testInfo) => {
  const { ana, ben, panels } = await twoPeopleInACardChat(
    browser,
    testInfo.project.use.baseURL!,
  )

  // The PDF upload is held back, so the message is sent while it uploads.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await ana.page.route('**/api/chats/*/files', async (route) => {
    if (route.request().postDataBuffer()?.includes('plan.pdf')) await held
    await route.continue()
  })

  // Ana attaches the PDF with "Attach file".
  const chooser = ana.page.waitForEvent('filechooser')
  await panels.ana!.chat.getByRole('button', { name: 'Attach file' }).click()
  await (
    await chooser
  ).setFiles([{ name: 'plan.pdf', mimeType: 'application/pdf', buffer: PDF }])
  await expect(panels.ana!.chat).toContainText('plan.pdf')

  // She pastes a PNG, as a screenshot from the clipboard.
  const box = panels.ana!.chat.getByRole('textbox', { name: 'Message' })
  await box.click()
  await ana.page.evaluate(
    (bytes: number[]) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }),
      )
      document.activeElement!.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    [...PNG],
  )
  await expect(panels.ana!.chat.getByText(SCREENSHOT)).toBeVisible()
  await expect(box).toHaveText('')

  // She types text and presses Enter while the PDF is still uploading.
  await box.pressSequentially('Here are the files')
  await box.press('Enter')
  await expect(
    panels.ana!.chat.getByText('Sends when the files finish uploading'),
  ).toBeVisible()
  await expectNoAccessibilityProblems(ana.page)
  await expect(messageOf(panels.ben!.chat, 'Here are the files')).toHaveCount(0)

  // The PDF finishes, and the message sends itself.
  release()
  const anaMessage = messageOf(panels.ana!.chat, 'Here are the files')
  await expect(anaMessage).toBeVisible()
  await expect(anaMessage).toContainText('plan.pdf')
  await expect(anaMessage.getByRole('img', { name: SCREENSHOT })).toBeVisible()
  await expect(
    panels.ana!.chat.getByText('Sends when the files finish uploading'),
  ).toHaveCount(0)

  // Ben sees the message with both files, without reloading.
  const benMessage = messageOf(panels.ben!.chat, 'Here are the files')
  await expect(benMessage).toBeVisible()
  await expect(benMessage).toContainText('plan.pdf')
  const png = benMessage.getByRole('img', { name: SCREENSHOT })
  await expect(png).toBeVisible()
  await expect
    .poll(() => png.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)

  // Ben downloads the PDF.
  const downloading = ben.page.waitForEvent('download')
  await benMessage.getByRole('link', { name: /^Download/ }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('plan.pdf')
  const chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk as Buffer))
  }
  expect(Buffer.concat(chunks)).toEqual(PDF)

  // Ben opens the PNG full size.
  await benMessage.getByRole('button', { name: SCREENSHOT }).click()
  const dialog = ben.page.getByRole('dialog', { name: SCREENSHOT })
  await expect(dialog.getByRole('img', { name: SCREENSHOT })).toBeVisible()
  await expectNoAccessibilityProblems(ben.page)
  await ben.page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // The card's Files section lists both "from chat".
  const benFiles = panels.ben!.card.getByRole('region', { name: 'Files' })
  const anaFiles = panels.ana!.card.getByRole('region', { name: 'Files' })
  for (const files of [benFiles, anaFiles]) {
    const pdfRow = files.getByRole('listitem').filter({ hasText: 'plan.pdf' })
    await expect(pdfRow).toContainText('from chat')
    await expect(pdfRow).toContainText('Added by Ana')
    await expect(
      files.getByRole('listitem').filter({ hasText: SCREENSHOT_IN_TEXT }),
    ).toContainText('from chat')
  }
  await expectNoAccessibilityProblems(ben.page)

  // "from chat" jumps to the message.
  await benFiles
    .getByRole('listitem')
    .filter({ hasText: 'plan.pdf' })
    .getByRole('link', { name: /from chat/i })
    .click()
  await expect(benMessage).toBeInViewport()
  await expect
    .poll(() =>
      benMessage.evaluate((el) => el.contains(document.activeElement)),
    )
    .toBe(true)

  // Ana removes the PDF from the message; it goes for both, and the PNG stays.
  await anaMessage.getByRole('button', { name: /^Remove.*plan\.pdf/ }).click()
  const confirm = ana.page.getByRole('dialog', { name: 'Remove ‘plan.pdf’?' })
  await expectNoAccessibilityProblems(ana.page)
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(anaMessage).not.toContainText('plan.pdf')
  await expect(benMessage).not.toContainText('plan.pdf')
  await expect(anaFiles).not.toContainText('plan.pdf')
  await expect(benFiles).not.toContainText('plan.pdf')
  await expect(benMessage.getByRole('img', { name: SCREENSHOT })).toBeVisible()

  // Ana deletes the message; the PNG is gone from the chat and the card.
  await anaMessage.getByRole('button', { name: 'Message options' }).click()
  await ana.page.getByRole('menuitem', { name: 'Delete' }).click()
  const deleting = ana.page.getByRole('dialog', {
    name: 'Delete this message?',
  })
  await expect(deleting).toContainText('Its file will be deleted too.')
  await deleting.getByRole('button', { name: 'Delete' }).click()
  for (const person of [panels.ana!, panels.ben!]) {
    await expect(
      person.chat.getByRole('img', { name: SCREENSHOT }),
    ).toHaveCount(0)
    await expect(person.card.getByText(SCREENSHOT)).toHaveCount(0)
  }
  await expectNoAccessibilityProblems(ana.page)
  await expectNoAccessibilityProblems(ben.page)
})
