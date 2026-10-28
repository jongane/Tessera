import { BadRequestException } from '@nestjs/common';

// Checks for the numbers and dates people type in for estimates and time
// (docs/card-features.md, section 6). Each one refuses bad input with a
// BadRequestException that says what is allowed.

export const MAX_ENTRY_MINUTES = 24 * 60;
export const MAX_ESTIMATE_MINUTES = 10_000 * 60;

// The latest any time zone runs ahead of UTC (Kiribati, UTC+14).
const LATEST_ZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

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
// date). The server does not know the person's time zone here, so a day is
// refused only once it has not yet started anywhere in the world.
export function requireWorkDate(text: string, now: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = new Date(`${text}T00:00:00Z`);
  if (!match || Number.isNaN(date.getTime()) || dateText(date) !== text) {
    throw new BadRequestException('A date must be written as YYYY-MM-DD');
  }
  const latestToday = new Date(now.getTime() + LATEST_ZONE_OFFSET_MS);
  if (dateText(date) > dateText(latestToday)) {
    throw new BadRequestException('Time cannot be logged for a future day');
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
// 24 hours, the most a single entry can hold.
export function timerMinutes(startedAt: Date, endedAt: Date): number {
  const minutes = Math.round(
    (endedAt.getTime() - startedAt.getTime()) / 60_000,
  );
  return Math.min(minutes, MAX_ENTRY_MINUTES);
}

function dateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}
