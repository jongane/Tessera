import { BadRequestException } from '@nestjs/common';
import { CardPriority } from '../generated/prisma/client.js';
import { localDate, requireDay } from '../time/time-input.js';

// Checks for a card's priority and due date (docs/card-features.md,
// section 8).

// A due date is either a day ("2026-11-01") or a moment with its time zone
// ("2026-11-01T17:30:00+10:00"); null clears it.
export type DueInput = { date: string } | { at: string } | null;

export interface Due {
  dueAt: Date | null;
  dueHasTime: boolean;
}

// The time zone is required, so the moment means the same for everyone.
const MOMENT_FORMAT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function requirePriority(priority: string): CardPriority {
  const priorities: string[] = Object.values(CardPriority);
  if (!priorities.includes(priority)) {
    throw new BadRequestException(
      `A priority must be one of ${priorities.join(', ')}`,
    );
  }
  return priority as CardPriority;
}

// A day without a time is stored as midnight UTC of that day.
export function parseDue(due: DueInput): Due {
  if (due === null) {
    return { dueAt: null, dueHasTime: false };
  }
  if ('date' in due) {
    return { dueAt: requireDay(due.date), dueHasTime: false };
  }
  const dueAt = new Date(due.at);
  if (!MOMENT_FORMAT.test(due.at) || Number.isNaN(dueAt.getTime())) {
    throw new BadRequestException(
      'A due time must be written like 2026-11-01T17:30:00+10:00, with its time zone',
    );
  }
  return { dueAt, dueHasTime: true };
}

// Whether `card` is due after `other`, for the warning shown when a subtask
// is due after its parent. Two moments are compared exactly; when either
// has no time, only the days are compared, a due time's day being the day
// it falls on in the project's time zone.
export function isDueAfter(card: Due, other: Due, timeZone = 'UTC'): boolean {
  if (!card.dueAt || !other.dueAt) {
    return false;
  }
  if (card.dueHasTime && other.dueHasTime) {
    return card.dueAt > other.dueAt;
  }
  return dayOf(card, timeZone) > dayOf(other, timeZone);
}

function dayOf(due: Due, timeZone: string): string {
  // A day without a time is already stored as midnight UTC of that day.
  const day = due.dueHasTime ? localDate(due.dueAt!, timeZone) : due.dueAt!;
  return day.toISOString().slice(0, 10);
}
