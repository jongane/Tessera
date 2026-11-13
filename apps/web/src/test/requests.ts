import { onTestFinished } from 'vitest'
import { server } from './server'

// Remembers every request the app sends to the fake API (MSW), with its
// headers, so a test can say which requests were made.
export function recordRequests() {
  const seen: { method: string; path: string; headers: Headers }[] = []
  const listener = ({ request }: { request: Request }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      headers: request.headers,
    })
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return {
    seen,
    // How many GET requests went to `path`.
    reads: (path: string) =>
      seen.filter((r) => r.method === 'GET' && r.path === path).length,
    // The requests that save something.
    saves: () => seen.filter((r) => r.method !== 'GET'),
    forget: () => {
      seen.length = 0
    },
  }
}
