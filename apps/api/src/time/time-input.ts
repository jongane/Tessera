import { BadRequestException } from '@nestjs/common';
import { MAX_ENTRY_MINUTES, MAX_ESTIMATE_MINUTES } from '@tessera/shared';

// Checks for the numbers and dates people type in for estimates and time
// (docs/card-features.md, section 6). Each one refuses bad input with a
// BadRequestException that says what is allowed.

export function requireEntryMinutes(minutes: number): number {
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_ENTRY_MINUTES
  ) {
    throw new BadRequestException(
      'A time entry must be a whole number of minutes, from 1 minute to 24 hours',
    );
  }
  return minutes;
}

// Null clears the estimate.
export function requireEstimateMinutes(minutes: number | null): number | null {
  if (
    minutes !== null &&
    (!Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > MAX_ESTIMATE_MINUTES)
  ) {
    throw new BadRequestException(
      'An estimate must be a whole number of minutes, up to 10,000 hours',
    );
  }
  return minutes;
}

// A day written as YYYY-MM-DD, returned as midnight UTC (how Prisma stores a
// date).
export function requireDay(text: string): Date {
  const date = new Date(`${text}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(date.getTime()) ||
    dateText(date) !== text
  ) {
    throw new BadRequestException('A date must be written as YYYY-MM-DD');
  }
  return date;
}

// A day for logged time. A day that has not started yet in the project's
// time zone is refused, even if it has started elsewhere in the world.
export function requireWorkDate(
  text: string,
  now: Date,
  timeZone: string,
): Date {
  const date = requireDay(text);
  if (date > localDate(now, timeZone)) {
    throw new BadRequestException(
      `Time can't be logged for a day that hasn't started yet in the project's time zone (${timeZone})`,
    );
  }
  return date;
}

// The day it is at `moment` in an IANA time zone such as "Europe/London",
// as midnight UTC.
export function localDate(moment: Date, timeZone: string): Date {
  let text: string;
  try {
    // The en-CA format is YYYY-MM-DD.
    text = new Intl.DateTimeFormat('en-CA', { timeZone }).format(moment);
  } catch {
    throw new BadRequestException(`Unknown time zone: ${timeZone}`);
  }
  return new Date(`${text}T00:00:00Z`);
}

// The minutes a timer ran, to the nearest minute. One timer saves at most
// 24 hours, the most a single entry can hold; `overLimit` says it ran longer.
export function timerMinutes(
  startedAt: Date,
  endedAt: Date,
): { minutes: number; overLimit: boolean } {
  const minutes = Math.round(
    (endedAt.getTime() - startedAt.getTime()) / 60_000,
  );
  return {
    minutes: Math.min(minutes, MAX_ENTRY_MINUTES),
    overLimit: minutes > MAX_ENTRY_MINUTES,
  };
}

function dateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}
