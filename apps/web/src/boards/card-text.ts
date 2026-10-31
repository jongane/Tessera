import type { BoardCard, CardPriority, LabelColourName } from '@tessera/shared'

export const PRIORITY_NAMES: Record<Exclude<CardPriority, 'NONE'>, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

// Soft background and strong text for each label colour. Every pair passes
// WCAG AA contrast (4.5:1) for small text.
export const LABEL_STYLES: Record<LabelColourName, string> = {
  GREY: 'bg-[#f0f0ec] text-[#45474d]',
  RED: 'bg-[#fde7e7] text-[#9b1c1c]',
  ORANGE: 'bg-[#fdeddf] text-[#8a3b0b]',
  YELLOW: 'bg-[#fbf3d0] text-[#6b4e00]',
  GREEN: 'bg-[#e7f4ec] text-[#1e6b3a]',
  TEAL: 'bg-[#e2f5f3] text-[#11615a]',
  BLUE: 'bg-[#e3eafd] text-[#1d3c96]',
  INDIGO: 'bg-[#e9e7fc] text-[#3b2f9e]',
  PURPLE: 'bg-[#f3e8fd] text-[#6b2fa3]',
  PINK: 'bg-[#fce7f1] text-[#962056]',
}

// "Due 31 Oct", or "Due 31 Oct, 17:00" when a time is set. A date without a
// time is stored as midnight UTC of that day, so it is read in UTC.
export function dueText(card: BoardCard, timeZone: string): string | null {
  if (!card.dueAt) {
    return null
  }
  const due = new Date(card.dueAt)
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: card.dueHasTime ? timeZone : 'UTC',
  }).format(due)
  if (!card.dueHasTime) {
    return `Due ${day}`
  }
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(due)
  return `Due ${day}, ${time}`
}

// "Assigned to Ben (owner) and Jon".
export function assigneesText(card: BoardCard): string {
  const names = card.assignees.map((person) =>
    person.isOwner ? `${person.displayName} (owner)` : person.displayName,
  )
  const list = new Intl.ListFormat('en-GB', {
    style: 'long',
    type: 'conjunction',
  }).format(names)
  return `Assigned to ${list}`
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

// Everything shown on a card besides its number and title, as one sentence
// for screen readers. The pieces on screen are separate boxes, which would
// otherwise be read out run together.
export function detailsText(card: BoardCard, timeZone: string): string {
  const { checklistProgress: checklist, subtaskProgress: subtasks } = card
  const due = dueText(card, timeZone)
  return [
    card.priority !== 'NONE' && `${PRIORITY_NAMES[card.priority]} priority`,
    card.labels.length > 0 &&
      `Labels: ${card.labels.map((label) => label.name).join(', ')}`,
    checklist.total > 0 &&
      `${checklist.done} of ${checklist.total} checklist items done`,
    subtasks.total > 0 &&
      `${subtasks.complete} of ${subtasks.total} subtasks done`,
    due,
    card.assignees.length > 0 && assigneesText(card),
  ]
    .filter(Boolean)
    .map((part) => `${part}.`)
    .join(' ')
}
