const DEFAULT_SWEEP_MS = 30_000;

// The number of milliseconds between two looks for expired sessions, from
// the text of LIVE_SESSION_SWEEP_MS. A number above zero is used as it is;
// anything else (missing, empty, not a number, zero, negative) gives 30000.
export function sweepIntervalFrom(value: string | undefined): number {
  const number = Number(value);
  return value?.trim() && Number.isFinite(number) && number > 0
    ? number
    : DEFAULT_SWEEP_MS;
}
