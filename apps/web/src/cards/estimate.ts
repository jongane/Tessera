import { joinMinutes, MAX_ESTIMATE_MINUTES } from '@tessera/shared'

// The estimate in minutes, null for none, or what is wrong with it.
export function estimateFrom(draft: {
  hours: string
  minutes: string
}): number | null | string {
  const hours = draft.hours.trim()
  const minutes = draft.minutes.trim()
  if (hours === '' && minutes === '') {
    return null
  }
  const wholeNumber = /^\d+$/
  if (
    (hours !== '' && !wholeNumber.test(hours)) ||
    (minutes !== '' && !wholeNumber.test(minutes))
  ) {
    return 'Use whole numbers'
  }
  const m = minutes === '' ? 0 : Number(minutes)
  if (m > 59) {
    return 'Minutes go up to 59'
  }
  const total = joinMinutes(hours === '' ? 0 : Number(hours), m)
  if (total > MAX_ESTIMATE_MINUTES) {
    return `Use at most ${MAX_ESTIMATE_MINUTES / 60} hours`
  }
  return total
}
