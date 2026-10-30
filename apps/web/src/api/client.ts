import type { ApiErrorBody } from '@tessera/shared'

// A refusal from the API (4xx or 5xx), or no answer at all (status 0).
// `message` can be shown to people as it is.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
}

const UNREACHABLE =
  'Tessera could not be reached. Check your connection and try again.'

// Calls the API at /api + `path`. The sign-in cookie goes along by itself,
// because the web app and the API share one address (docs/adr/0001).
export async function api<T>(
  path: string,
  { method = 'GET', body }: RequestOptions = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(new URL(`/api${path}`, window.location.origin), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response))
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>
    if (typeof body.message === 'string') {
      return body.message
    }
  } catch {
    // Not JSON: fall through to a general message.
  }
  return `Something went wrong (${response.status}). Try again.`
}

export function isApiError(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status
}
