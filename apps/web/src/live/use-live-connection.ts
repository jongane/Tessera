import { useSyncExternalStore } from 'react'
import {
  getCurrentConnection,
  type LiveConnection,
  watchCurrentConnection,
} from './live-connection'

// The tab's live connection, or null before it is open.
export function useLiveConnection(): LiveConnection | null {
  return useSyncExternalStore(watchCurrentConnection, getCurrentConnection)
}
