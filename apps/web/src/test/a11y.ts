import axe from 'axe-core'
import { expect } from 'vitest'

// Checks the page for accessibility problems axe can find (WCAG 2.2 AA).
// Colour contrast needs a real browser, so it is checked there instead.
export async function expectNoAccessibilityProblems(container: Element) {
  const results = await axe.run(container, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(
    results.violations.map((v) => `${v.id}: ${v.help}`),
  ).toEqual([])
}
