import { sweepIntervalFrom } from './live-sweep.js';

// Live updates PR, review and attack fixes round 3 (criterion 54).
//
// Contract: `sweepIntervalFrom(value: string | undefined): number` is exported
// from `apps/api/src/live/live-sweep.ts`. It turns the text of the
// LIVE_SESSION_SWEEP_MS environment variable into the number of milliseconds
// between two looks for expired sessions. A number from 1000 to 86400000
// (one day) is used as it is; anything else (missing, empty, not a number,
// zero, negative, below 1000, above a day, such as 0.5 or 999) gives 30000
// (criteria 54 and 56). The service uses it instead of Number(...).
describe('sweepIntervalFrom', () => {
  // 54, 56
  it.each([
    [undefined, 30000],
    ['', 30000],
    ['abc', 30000],
    ['0', 30000],
    ['-5', 30000],
    ['NaN', 30000],
    ['Infinity', 30000],
    ['0.5', 30000],
    ['200', 30000],
    ['999', 30000],
    ['86400001', 30000],
  ])('gives 30000 for %j', (value, expected) => {
    expect(sweepIntervalFrom(value)).toBe(expected);
  });

  // 54, 56
  it('uses a number from 1000 to a day as it is', () => {
    expect(sweepIntervalFrom('1000')).toBe(1000);
    expect(sweepIntervalFrom('60000')).toBe(60000);
    expect(sweepIntervalFrom('86400000')).toBe(86400000);
  });
});
