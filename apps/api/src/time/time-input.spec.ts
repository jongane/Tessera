import { BadRequestException } from '@nestjs/common';
import {
  localDate,
  requireEntryMinutes,
  requireEstimateMinutes,
  requireWorkDate,
  timerMinutes,
} from './time-input.js';

describe('requireEntryMinutes', () => {
  it.each([1, 90, 1440])('accepts %i minutes', (minutes) => {
    expect(requireEntryMinutes(minutes)).toBe(minutes);
  });

  it.each([0, -5, 1441, 1.5, Number.NaN])('refuses %s minutes', (minutes) => {
    expect(() => requireEntryMinutes(minutes)).toThrow(BadRequestException);
  });
});

describe('requireEstimateMinutes', () => {
  it.each([0, 45, 600_000, null])('accepts %s', (minutes) => {
    expect(requireEstimateMinutes(minutes)).toBe(minutes);
  });

  it.each([-1, 2.5, 600_001])('refuses %s', (minutes) => {
    expect(() => requireEstimateMinutes(minutes)).toThrow(BadRequestException);
  });
});

// Criteria 1 and 9: "today" is today in the project's time zone.
describe('requireWorkDate', () => {
  // 23:30 UTC on 27 October: 10:30 on the 28th in Sydney (UTC+11) and
  // 19:30 on the 27th in New York (UTC-4).
  const now = new Date('2026-10-27T23:30:00Z');

  // Criterion 1
  it('accepts today and earlier days in the project time zone', () => {
    expect(requireWorkDate('2026-10-27', now, 'UTC')).toEqual(
      new Date('2026-10-27T00:00:00Z'),
    );
    expect(requireWorkDate('2026-10-28', now, 'Australia/Sydney')).toEqual(
      new Date('2026-10-28T00:00:00Z'),
    );
    expect(requireWorkDate('2026-10-27', now, 'America/New_York')).toEqual(
      new Date('2026-10-27T00:00:00Z'),
    );
    expect(requireWorkDate('2025-02-28', now, 'America/New_York')).toEqual(
      new Date('2025-02-28T00:00:00Z'),
    );
  });

  // Criterion 1
  it('refuses a later day even when it has started elsewhere in the world', () => {
    expect(() => requireWorkDate('2026-10-28', now, 'UTC')).toThrow(
      BadRequestException,
    );
    expect(() =>
      requireWorkDate('2026-10-29', now, 'Australia/Sydney'),
    ).toThrow(BadRequestException);
    // Already the 28th in UTC and Sydney, but not yet in New York.
    expect(() =>
      requireWorkDate('2026-10-28', now, 'America/New_York'),
    ).toThrow(BadRequestException);
  });

  // Criterion 1: the old "tomorrow somewhere in the world" allowance is gone.
  it('refuses tomorrow in UTC even once it is tomorrow in UTC+14', () => {
    const later = new Date('2026-10-28T11:00:00Z');
    expect(() => requireWorkDate('2026-10-29', later, 'UTC')).toThrow(
      BadRequestException,
    );
  });

  // Criterion 1: the day turns over at midnight in the project's zone.
  it('accepts a day from midnight in the project time zone', () => {
    const justBefore = new Date('2026-10-28T12:59:59Z'); // 23:59:59 in Sydney
    const midnight = new Date('2026-10-28T13:00:00Z'); // 00:00 on the 29th
    expect(() =>
      requireWorkDate('2026-10-29', justBefore, 'Australia/Sydney'),
    ).toThrow(BadRequestException);
    expect(requireWorkDate('2026-10-29', midnight, 'Australia/Sydney')).toEqual(
      new Date('2026-10-29T00:00:00Z'),
    );
  });

  // Criterion 9
  it("names the project's time zone when it refuses a future day", () => {
    expect(() =>
      requireWorkDate('2026-10-28', now, 'America/New_York'),
    ).toThrow(
      "Time can't be logged for a day that hasn't started yet in the project's time zone (America/New_York)",
    );
    expect(() => requireWorkDate('2026-10-30', now, 'Europe/London')).toThrow(
      "Time can't be logged for a day that hasn't started yet in the project's time zone (Europe/London)",
    );
  });

  it.each(['2026-02-30', '28/10/2026', '2026-10-28T10:00', ''])(
    'refuses the badly formed date "%s"',
    (text) => {
      expect(() => requireWorkDate(text, now, 'UTC')).toThrow(
        'A date must be written as YYYY-MM-DD',
      );
    },
  );
});

describe('localDate', () => {
  it("gives the day in the person's time zone", () => {
    const lateEvening = new Date('2026-10-27T23:30:00Z');

    expect(localDate(lateEvening, 'UTC')).toEqual(
      new Date('2026-10-27T00:00:00Z'),
    );
    expect(localDate(lateEvening, 'Australia/Sydney')).toEqual(
      new Date('2026-10-28T00:00:00Z'),
    );
    expect(localDate(lateEvening, 'America/New_York')).toEqual(
      new Date('2026-10-27T00:00:00Z'),
    );
  });

  it('refuses an unknown time zone', () => {
    expect(() => localDate(new Date(), 'Mars/Olympus')).toThrow(
      BadRequestException,
    );
  });
});

describe('timerMinutes', () => {
  const start = new Date('2026-10-27T09:00:00Z');
  const after = (seconds: number) => new Date(start.getTime() + seconds * 1000);

  it('rounds to the nearest minute', () => {
    expect(timerMinutes(start, after(29))).toEqual({
      minutes: 0,
      overLimit: false,
    });
    expect(timerMinutes(start, after(30)).minutes).toBe(1);
    expect(timerMinutes(start, after(25 * 60 + 40)).minutes).toBe(26);
  });

  it('saves at most 24 hours from one timer, and says when it ran longer', () => {
    expect(timerMinutes(start, after(30 * 3600))).toEqual({
      minutes: 1440,
      overLimit: true,
    });
    expect(timerMinutes(start, after(24 * 3600 + 29))).toEqual({
      minutes: 1440,
      overLimit: false,
    });
  });
});
