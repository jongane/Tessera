const DEFAULT_SWEEP_MS = 30_000;
const MIN_SWEEP_MS = 1000;
const MAX_SWEEP_MS = 86_400_000;

// The number of milliseconds between two looks for expired sessions, from
// the text of LIVE_SESSION_SWEEP_MS. A number from 1000 to 86400000 is used
// as it is; anything else (missing, empty, not a number, outside that range)
// gives 30000.
export function sweepIntervalFrom(value: string | undefined): number {
  const number = Number(value);
  return value?.trim() && number >= MIN_SWEEP_MS && number <= MAX_SWEEP_MS
    ? number
    : DEFAULT_SWEEP_MS;
}
