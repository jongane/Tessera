import { messageBodyRequestSchema, type Message } from '@tessera/shared'
import { ApiError } from '../api/client'
export { markdownOf } from '../ui/markdown-of'
import { FORMER_MEMBER } from '../ui/former-member'
import { checkForm } from '../ui/form-errors'

export const DELETED_AUTHOR_NAME = FORMER_MEMBER

export const COULDNT_SEND = 'Couldn’t send'
export const COULDNT_SAVE = 'Couldn’t save, try again'

// A message sent by the same person within this long of the one before it
// shows no name and time of its own.
const GROUP_MS = 5 * 60_000

// Whether `message` follows `previous` closely enough, from the same person,
// to share its name and time. A deleted account's messages are never grouped,
// as they may be from different people.
export function followsOnFrom(
  message: Message,
  previous: Message | undefined,
): boolean {
  return (
    previous !== undefined &&
    message.author !== null &&
    previous.author?.id === message.author.id &&
    Date.parse(message.createdAt) - Date.parse(previous.createdAt) <= GROUP_MS
  )
}

// The API's input check starts its message with the field name ("body: ").
const FIELD_PREFIX = /^[A-Za-z][\w.]*: /

// What to tell the person when a change failed: the API's own message when it
// refused the change (4xx), else `general`.
export function refusalOr(error: unknown, general: string): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message.replace(FIELD_PREFIX, '')
    : general
}

// A web address a message may link to: http, https or mailto, never
// `javascript:` or anything else.
export function isSafeLink(href: string | undefined): boolean {
  if (!href) {
    return false
  }
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol)
  } catch {
    return false
  }
}

// A card number such as WEB-12 or WEB-12.1, written in capitals, in a text.
export const CARD_NUMBER_IN_TEXT =
  /(?<![A-Za-z0-9-])[A-Z]{2,6}-[1-9][0-9]*(?:\.[1-9][0-9]*)*(?![A-Za-z0-9-])/g

// The text to send, or why it cannot be sent. Blank text has no reason: there
// is nothing to send.
export function checkMessage(
  markdown: string,
): { ok: true; body: string } | { ok: false; reason?: string } {
  if (markdown === '') {
    return { ok: false }
  }
  const checked = checkForm(messageBodyRequestSchema, { body: markdown })
  return checked.ok
    ? { ok: true, body: checked.data.body }
    : { ok: false, reason: checked.errors.body ?? 'Check the message' }
}
