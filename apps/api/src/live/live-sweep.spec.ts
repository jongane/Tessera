import { sweepIntervalFrom } from './live-sweep.js';

// Live updates PR, review and attack fixes round 3 (criterion 54).
//
// Contract: `sweepIntervalFrom(value: string | undefined): number` is exported
// from `apps/api/src/live/live-sweep.ts`. It turns the text of the
// LIVE_SESSION_SWEEP_MS environment variable into the number of milliseconds
// between two looks for expired sessions. A whole or decimal number above
// zero is used as it is; anything else (missing, empty, not a number, zero,
// negative) gives 30000. The service uses it instead of Number(...).
describe('sweepIntervalFrom', () => {
  // 54
  it.each([
    [undefined, 30000],
    ['', 30000],
    ['abc', 30000],
    ['0', 30000],
    ['-5', 30000],
    ['NaN', 30000],
    ['Infinity', 30000],
  ])('gives 30000 for %j', (value, expected) => {
    expect(sweepIntervalFrom(value)).toBe(expected);
  });

  // 54
  it('uses a positive number as it is', () => {
    expect(sweepIntervalFrom('200')).toBe(200);
    expect(sweepIntervalFrom('60000')).toBe(60000);
  });
});
