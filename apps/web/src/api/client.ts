import type { ApiErrorBody } from '@tessera/shared'

// A refusal from the API (4xx or 5xx), or no answer at all (status 0).
// `message` can be shown to people as it is.
// `details` holds the rest of the API's answer, such as `loggedMinutes`.
export class ApiError extends Error {
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
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
    const body = await errorBody(response)
    throw new ApiError(response.status, errorMessage(response, body), body)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

async function errorBody(
  response: Response,
): Promise<Partial<ApiErrorBody> & Record<string, unknown>> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    // Not JSON: a general message is shown.
    return {}
  }
}

function errorMessage(response: Response, body: Partial<ApiErrorBody>): string {
  return typeof body.message === 'string'
    ? body.message
    : `Something went wrong (${response.status}). Try again.`
}

export function isApiError(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status
}
