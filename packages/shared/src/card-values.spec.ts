import { describe, expect, it } from 'vitest';
import {
  cardChangesSchema,
  dueFromParts,
  dueParts,
  formatMinutes,
  joinMinutes,
  splitMinutes,
} from './index.js';

describe('splitMinutes and joinMinutes', () => {
  it('splits minutes into hours and minutes', () => {
    expect(splitMinutes(200)).toEqual({ hours: 3, minutes: 20 });
    expect(splitMinutes(45)).toEqual({ hours: 0, minutes: 45 });
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 });
  });

  it('joins hours and minutes back into minutes', () => {
    expect(joinMinutes(3, 20)).toBe(200);
    expect(joinMinutes(0, 0)).toBe(0);
  });
});

describe('formatMinutes', () => {
  it('writes hours and minutes, leaving out a part that is zero', () => {
    expect(formatMinutes(200)).toBe('3h 20m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(0)).toBe('0m');
  });
});

describe('dueFromParts', () => {
  it('gives a day alone when there is no time', () => {
    expect(dueFromParts('2026-11-02', '', 'Europe/London')).toEqual({
      date: '2026-11-02',
    });
  });

  it('reads the time in the project’s time zone, with its offset', () => {
    // London is on UTC in November and an hour ahead in July.
    expect(dueFromParts('2026-11-02', '17:00', 'Europe/London')).toEqual({
      at: '2026-11-02T17:00:00+00:00',
    });
    expect(dueFromParts('2026-07-02', '17:00', 'Europe/London')).toEqual({
      at: '2026-07-02T17:00:00+01:00',
    });
    expect(dueFromParts('2026-11-02', '09:30', 'America/New_York')).toEqual({
      at: '2026-11-02T09:30:00-05:00',
    });
    expect(dueFromParts('2026-11-02', '09:30', 'Asia/Kolkata')).toEqual({
      at: '2026-11-02T09:30:00+05:30',
    });
  });

  it('gives what the API accepts', () => {
    const due = dueFromParts('2026-07-02', '17:00', 'Europe/London');
    expect(cardChangesSchema.safeParse({ due }).success).toBe(true);
  });
});

describe('dueParts', () => {
  it('gives the day of a due date without a time, read in UTC', () => {
    expect(dueParts('2026-11-02T00:00:00.000Z', false, 'Asia/Tokyo')).toEqual({
      date: '2026-11-02',
      time: '',
    });
  });

  it('gives the day and time in the project’s time zone', () => {
    expect(dueParts('2026-07-02T16:00:00.000Z', true, 'Europe/London')).toEqual(
      { date: '2026-07-02', time: '17:00' },
    );
    // Late in the evening in New York is the next day in UTC.
    expect(
      dueParts('2026-11-03T03:30:00.000Z', true, 'America/New_York'),
    ).toEqual({ date: '2026-11-02', time: '22:30' });
  });

  it('gives empty parts when there is no due date', () => {
    expect(dueParts(null, false, 'UTC')).toEqual({ date: '', time: '' });
  });

  it('turns back into the same moment', () => {
    const parts = dueParts('2026-07-02T16:00:00.000Z', true, 'Europe/London');
    const due = dueFromParts(parts.date, parts.time, 'Europe/London');
    expect(new Date((due as { at: string }).at).toISOString()).toBe(
      '2026-07-02T16:00:00.000Z',
    );
  });
});
