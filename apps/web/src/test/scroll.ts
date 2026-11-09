import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// jsdom does not lay anything out, so a scrolling list has no height. These
// helpers give every element a height that grows with its text, and let a
// test scroll a message list as a person would. The tests do not know which
// element of the chat panel scrolls, so they act on the list and on every
// element around it up to the panel, and accept either way of scrolling to
// the bottom: setting `scrollTop`, or `scrollIntoView` on a message.

const VIEW_HEIGHT = 300
const originalScrollIntoView = Element.prototype.scrollIntoView

export function stubLayout() {
  const into: Element[] = []
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEW_HEIGHT,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return VIEW_HEIGHT + 5 * (this.textContent?.length ?? 0)
    },
  })
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    into.push(this)
  })
  return {
    // Elements `scrollIntoView` was called on since the last `forget`.
    into,
    forget: () => {
      into.length = 0
    },
    restore: () => {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .clientHeight
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .scrollHeight
      Element.prototype.scrollIntoView = originalScrollIntoView
    },
  }
}

// The list and the elements around it, up to the chat panel.
export function scrollers(list: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  for (let node: HTMLElement | null = list; node; node = node.parentElement) {
    chain.push(node)
    if (node.tagName === 'ASIDE') break
  }
  return chain
}

export function scrollTo(list: HTMLElement, top: number) {
  for (const element of scrollers(list)) {
    element.scrollTop = top
    fireEvent.scroll(element)
  }
}

// A person scrolling the list to its newest message.
export function scrollToBottom(list: HTMLElement) {
  for (const element of scrollers(list)) {
    element.scrollTop = element.scrollHeight - element.clientHeight
    fireEvent.scroll(element)
  }
}

function atBottom(element: HTMLElement) {
  return (
    element.scrollTop > 0 &&
    element.scrollTop >= element.scrollHeight - element.clientHeight - 1
  )
}

// Whether the list has been scrolled to its newest message since `forget`.
export function isAtBottom(
  list: HTMLElement,
  layout: ReturnType<typeof stubLayout>,
): boolean {
  return (
    scrollers(list).some(atBottom) ||
    layout.into.some((element) => list.contains(element))
  )
}

// Whether nothing has scrolled since `forget` and every element is still at
// the top.
export function hasNotMoved(
  list: HTMLElement,
  layout: ReturnType<typeof stubLayout>,
): boolean {
  return (
    scrollers(list).every((element) => element.scrollTop === 0) &&
    layout.into.length === 0
  )
}

// The heights before, to tell afterwards whether the reading position held.
export function heights(list: HTMLElement) {
  return new Map(scrollers(list).map((e) => [e, e.scrollHeight]))
}

// After older messages were added above: the same text is still at the same
// place, so the scroll position grew by exactly the height that was added; or
// the message that was first before was scrolled back into view.
export function keptPlace(
  list: HTMLElement,
  before: Map<HTMLElement, number>,
  layout: ReturnType<typeof stubLayout>,
  previousFirst: HTMLElement,
): boolean {
  return (
    scrollers(list).some(
      (e) =>
        e.scrollHeight > (before.get(e) ?? 0) &&
        Math.abs(e.scrollTop - (e.scrollHeight - (before.get(e) ?? 0))) < 1,
    ) ||
    layout.into.some(
      (e) => e.contains(previousFirst) || previousFirst.contains(e),
    )
  )
}
