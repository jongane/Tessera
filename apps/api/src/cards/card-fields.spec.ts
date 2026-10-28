import { BadRequestException } from '@nestjs/common';
import { isDueAfter, parseDue, requirePriority } from './card-fields.js';

describe('requirePriority', () => {
  it.each(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])('accepts %s', (p) => {
    expect(requirePriority(p)).toBe(p);
  });

  it.each(['urgent', 'CRITICAL', ''])('refuses "%s"', (p) => {
    expect(() => requirePriority(p)).toThrow(BadRequestException);
  });
});

describe('parseDue', () => {
  it('stores a day without a time as midnight UTC', () => {
    expect(parseDue({ date: '2026-11-01' })).toEqual({
      dueAt: new Date('2026-11-01T00:00:00Z'),
      dueHasTime: false,
    });
  });

  it('stores a day and time as that moment', () => {
    expect(parseDue({ at: '2026-11-01T17:30:00+10:00' })).toEqual({
      dueAt: new Date('2026-11-01T07:30:00Z'),
      dueHasTime: true,
    });
    expect(parseDue({ at: '2026-11-01T17:30Z' }).dueAt).toEqual(
      new Date('2026-11-01T17:30:00Z'),
    );
  });

  it('clears the due date', () => {
    expect(parseDue(null)).toEqual({ dueAt: null, dueHasTime: false });
  });

  it.each([
    { date: '2026-02-30' },
    { date: '01/11/2026' },
    // A time needs its time zone, or the moment is unclear.
    { at: '2026-11-01T17:30:00' },
    { at: 'tomorrow' },
  ])('refuses %o', (due) => {
    expect(() => parseDue(due)).toThrow(BadRequestException);
  });
});

describe('isDueAfter', () => {
  const day = (date: string) => ({
    dueAt: new Date(`${date}T00:00:00Z`),
    dueHasTime: false,
  });
  const moment = (iso: string) => ({ dueAt: new Date(iso), dueHasTime: true });
  const none = { dueAt: null, dueHasTime: false };

  it('compares two moments exactly', () => {
    expect(
      isDueAfter(moment('2026-11-01T18:00Z'), moment('2026-11-01T17:00Z')),
    ).toBe(true);
    expect(
      isDueAfter(moment('2026-11-01T16:00Z'), moment('2026-11-01T17:00Z')),
    ).toBe(false);
  });

  it('compares by day when either has no time', () => {
    expect(isDueAfter(moment('2026-11-01T18:00Z'), day('2026-11-01'))).toBe(
      false,
    );
    expect(isDueAfter(day('2026-11-02'), moment('2026-11-01T23:00Z'))).toBe(
      true,
    );
    expect(isDueAfter(day('2026-11-01'), day('2026-11-01'))).toBe(false);
  });

  it("finds a due time's day in the project's time zone", () => {
    // 9am on 6 Nov in Sydney is still 5 Nov in UTC.
    const parent = moment('2026-11-05T22:00Z');
    const subtask = day('2026-11-06');

    expect(isDueAfter(subtask, parent, 'UTC')).toBe(true);
    expect(isDueAfter(subtask, parent, 'Australia/Sydney')).toBe(false);
  });

  it('never warns when either has no due date', () => {
    expect(isDueAfter(none, day('2026-11-01'))).toBe(false);
    expect(isDueAfter(day('2026-11-01'), none)).toBe(false);
  });
});
