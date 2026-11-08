import { useSyncExternalStore } from 'react'

// The running time of a timer as h:mm:ss, from when it started.
export function runningTime(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function everyHalfSecond(onTick: () => void) {
  const timer = setInterval(onTick, 500)
  return () => clearInterval(timer)
}

function never() {
  return () => {}
}

function thisSecond() {
  return Math.floor(Date.now() / 1000) * 1000
}

// The time now, in milliseconds, drawn again every second while `ticking`.
export function useNow(ticking: boolean): number {
  return useSyncExternalStore(ticking ? everyHalfSecond : never, thisSecond)
}
