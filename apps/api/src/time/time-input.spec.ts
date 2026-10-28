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

describe('requireWorkDate', () => {
  const now = new Date('2026-10-28T09:00:00Z');

  it('accepts today and earlier days', () => {
    expect(requireWorkDate('2026-10-28', now)).toEqual(
      new Date('2026-10-28T00:00:00Z'),
    );
    expect(requireWorkDate('2025-02-28', now)).toEqual(
      new Date('2025-02-28T00:00:00Z'),
    );
  });

  // At 11:00 UTC it is already 01:00 tomorrow in UTC+14, but at 09:00 UTC
  // tomorrow has not started anywhere.
  it('accepts tomorrow once it is tomorrow somewhere in the world', () => {
    expect(() => requireWorkDate('2026-10-29', now)).toThrow(
      BadRequestException,
    );
    const later = new Date('2026-10-28T11:00:00Z');
    expect(requireWorkDate('2026-10-29', later)).toEqual(
      new Date('2026-10-29T00:00:00Z'),
    );
  });

  it('refuses a day that has not started anywhere yet', () => {
    const lateInDay = new Date('2026-10-28T23:59:00Z');
    expect(() => requireWorkDate('2026-10-30', lateInDay)).toThrow(
      BadRequestException,
    );
  });

  it.each(['2026-02-30', '28/10/2026', '2026-10-28T10:00', ''])(
    'refuses the badly formed date "%s"',
    (text) => {
      expect(() => requireWorkDate(text, now)).toThrow(BadRequestException);
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
