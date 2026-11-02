// Turning card values into what people type and read, and back: estimates
// in hours and minutes (docs/card-features.md, section 6), and due dates
// typed in the project's time zone (section 8).

export function splitMinutes(total: number): {
  hours: number;
  minutes: number;
} {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function joinMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

// "3h 20m", "2h" or "45m".
export function formatMinutes(total: number): string {
  const { hours, minutes } = splitMinutes(total);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export type DueValue = { date: string } | { at: string };

// The `due` value for PATCH /api/cards/:cardId from a day ("2026-11-02")
// and a time ("17:00", or "" for none), read in `timeZone`.
export function dueFromParts(
  date: string,
  time: string,
  timeZone: string,
): DueValue {
  if (time === '') {
    return { date };
  }
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at that moment. Checked twice, because the guess can
  // fall on the other side of a clock change.
  let offset = offsetMinutes(wallClock, timeZone);
  offset = offsetMinutes(wallClock - offset * 60_000, timeZone);
  return { at: `${date}T${time}:00${offsetText(offset)}` };
}

// The day and time ("" when none) a due date is shown with. A day without a
// time is stored as midnight UTC, so it is read in UTC.
export function dueParts(
  dueAt: string | null,
  dueHasTime: boolean,
  timeZone: string,
): { date: string; time: string } {
  if (!dueAt) {
    return { date: '', time: '' };
  }
  const moment = new Date(dueAt);
  const parts = wallClockParts(moment.getTime(), dueHasTime ? timeZone : 'UTC');
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return {
    date,
    time: dueHasTime ? `${pad(parts.hour)}:${pad(parts.minute)}` : '',
  };
}

// How far `timeZone` is ahead of UTC at `time`, in minutes.
function offsetMinutes(time: number, timeZone: string): number {
  const p = wallClockParts(time, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(time / 60_000) * 60_000) / 60_000);
}

function wallClockParts(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

// "+01:00", "-05:00", "+05:30".
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const size = Math.abs(minutes);
  return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
