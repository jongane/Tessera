import {
  type ActivityCardRef,
  type ActivityDetails,
  type ActivityKind,
  type ActivityLine,
  type ActivityTimeEntry,
  dueParts,
  formatMinutes,
} from '@tessera/shared'
import { FORMER_MEMBER } from '../ui/former-member'
import { PRIORITY_NAMES } from '../boards/card-text'

// The sentence for each kind of history line (docs/card-features.md,
// section 9), starting with the person's name.

export interface SentenceContext {
  projectCode: string
  // The project's time zone: due times, and which year is "this year".
  timeZone: string
  now: Date
}

export const DELETED_ACCOUNT = FORMER_MEMBER

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// What follows the person's name. `actorId` is null for a deleted account.
type Say<K extends ActivityKind> = (
  details: ActivityDetails[K],
  context: SentenceContext,
  actorId: string | null,
) => string

// A missing entry here does not compile: every kind needs a sentence.
const SAYINGS: { [K in ActivityKind]: Say<K> } = {
  CREATED: (d, c) => `created this card as ${number(c, d.numberPath)}`,
  TITLE_CHANGED: (d) => `renamed this from ${quote(d.from)} to ${quote(d.to)}`,
  DESCRIPTION_CHANGED: () => 'changed the description',
  PRIORITY_CHANGED: (d) =>
    `changed the priority from ${priority(d.from)} to ${priority(d.to)}`,
  DUE_DATE_CHANGED: (d, c) =>
    setChangedRemoved(
      'the due date',
      d.from.at === null ? null : dueText(d.from, c),
      d.to.at === null ? null : dueText(d.to, c),
    ),
  ESTIMATE_CHANGED: (d) =>
    setChangedRemoved(
      'the estimate',
      d.from === null ? null : formatMinutes(d.from),
      d.to === null ? null : formatMinutes(d.to),
    ),
  MOVED: (d) => `moved this from ${d.from.name} to ${d.to.name}`,
  COMPLETED: () => 'completed this',
  REOPENED: () => 'reopened this',
  ASSIGNEE_ADDED: (d) =>
    `assigned ${d.user.displayName}${d.isOwner ? ' (as owner)' : ''}`,
  ASSIGNEE_REMOVED: (d) => `unassigned ${d.user.displayName}`,
  OWNER_CHANGED: (d) =>
    d.to === null ? 'removed the owner' : `made ${d.to.displayName} the owner`,
  LABEL_ADDED: (d) => `added the label ${d.name}`,
  LABEL_REMOVED: (d) => `removed the label ${d.name}`,
  SUBTASK_ADDED: (d, c) => `added the subtask ${cardText(c, d.subtask)}`,
  SUBTASK_REMOVED: (d, c) =>
    d.deleted
      ? `deleted the subtask ${cardText(c, d.subtask)}`
      : `moved the subtask ${cardText(c, d.subtask)} to another parent`,
  PARENT_CHANGED: (d, c) => {
    if (d.to === null) {
      return 'made this its own card'
    }
    return d.from === null
      ? `made this a subtask of ${cardText(c, d.to)}`
      : `moved this from ${number(c, d.from.numberPath)} to ${number(c, d.to.numberPath)}`
  },
  NUMBER_CHANGED: (d, c) =>
    `changed the number from ${number(c, d.from)} to ${number(c, d.to)}`,
  TIME_LOGGED: (d, c, actorId) => {
    const who = d.user.id === actorId ? '' : ` ${d.user.displayName} on`
    const day = dayText(d.workDate, c)
    const timer = d.fromTimer ? ' (timer)' : ''
    return `logged ${formatMinutes(d.minutes)} for${who} ${day}${timer}`
  },
  TIME_ENTRY_EDITED: (d, c, actorId) =>
    `changed ${possessive(d.user, actorId)} time from ${entryText(d.from, c)} to ${entryText(d.to, c)}`,
  TIME_ENTRY_DELETED: (d, c, actorId) =>
    `deleted ${possessive(d.user, actorId)} ${formatMinutes(d.minutes)} for ${dayText(d.workDate, c)}`,
  CHECKLIST_ADDED: (d) => `added the checklist ${quote(d.name)}`,
  CHECKLIST_RENAMED: (d) =>
    `renamed the checklist ${quote(d.from)} to ${quote(d.to)}`,
  CHECKLIST_DELETED: (d) => `deleted the checklist ${quote(d.name)}`,
  CHECKLIST_ITEM_TO_SUBTASK: (d, c) =>
    `turned ${quote(d.subtask.title)} from ${d.checklistName} into ${number(c, d.subtask.numberPath)}`,
}

// "Jon moved this from To do to In progress".
export function activitySentence(
  line: ActivityLine,
  context: SentenceContext,
): string {
  const actorId = line.actor?.id ?? null
  // The API may be newer than this page and send a kind it does not know.
  const say = (SAYINGS as Partial<Record<string, Say<ActivityKind>>>)[line.kind]
  // TypeScript cannot match a line's kind to its sentence by itself.
  const text = say
    ? say(line.details as never, context, actorId)
    : 'made a change this page can’t show yet'
  return `${line.actor?.displayName ?? DELETED_ACCOUNT} ${text}`
}

function quote(text: string) {
  return `‘${text}’`
}

function number(context: SentenceContext, numberPath: string) {
  return `${context.projectCode}-${numberPath}`
}

function cardText(context: SentenceContext, card: ActivityCardRef) {
  return `${number(context, card.numberPath)} ${card.title}`
}

function priority(value: keyof typeof PRIORITY_NAMES | 'NONE') {
  return value === 'NONE' ? 'None' : PRIORITY_NAMES[value]
}

// "set the due date to X", "changed the due date from X to Y" or "removed
// the due date"; the values are null when there is none.
function setChangedRemoved(
  what: string,
  from: string | null,
  to: string | null,
) {
  if (to === null) {
    return from === null ? `changed ${what}` : `removed ${what}`
  }
  return from === null
    ? `set ${what} to ${to}`
    : `changed ${what} from ${from} to ${to}`
}

// "Sam’s", or "their own" when the person changed their own time.
function possessive(
  user: { id: string; displayName: string },
  actorId: string | null,
) {
  return user.id === actorId ? 'their own' : `${user.displayName}’s`
}

function entryText(entry: ActivityTimeEntry, context: SentenceContext) {
  return `${formatMinutes(entry.minutes)} on ${dayText(entry.workDate, context)}`
}

// "4 Nov, 17:00 Europe/London", or "4 Nov" for a day without a time.
function dueText(
  due: { at: string | null; hasTime: boolean },
  context: SentenceContext,
) {
  const parts = dueParts(due.at, due.hasTime, context.timeZone)
  const day = dayText(parts.date, context)
  return due.hasTime ? `${day}, ${parts.time} ${context.timeZone}` : day
}

// "2 Nov", with the year when it is not this one in the project's time
// zone. `date` is a day, "2026-11-02", the same in every zone.
function dayText(date: string, context: SentenceContext) {
  const [year, month, day] = date.split('-').map(Number)
  const thisYear = Number(
    dueParts(context.now.toISOString(), true, context.timeZone).date.slice(
      0,
      4,
    ),
  )
  const text = `${day} ${MONTHS[month! - 1]}`
  return year === thisYear ? text : `${text} ${year}`
}
