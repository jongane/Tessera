import { createRequire } from 'node:module'
import { expect, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)

// Checks the page with axe in a real browser, colour contrast included
// (WCAG 2.2 AA).
export async function expectNoAccessibilityProblems(page: Page) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  const violations = await page.evaluate(async () => {
    const results = await (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: object,
          ) => Promise<{ violations: { id: string; help: string }[] }>
        }
      }
    ).axe.run(document, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    })
    return results.violations.map((v) => `${v.id}: ${v.help}`)
  })
  expect(violations).toEqual([])
}
