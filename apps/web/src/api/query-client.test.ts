import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { createQueryClient } from './query-client'

describe('createQueryClient', () => {
  const retry = createQueryClient().getDefaultOptions().queries?.retry as (
    failures: number,
    error: unknown,
  ) => boolean

  it('tries again after a network or server problem, at most twice', () => {
    expect(retry(0, new ApiError(0, 'Unreachable'))).toBe(true)
    expect(retry(1, new ApiError(503, 'Unavailable'))).toBe(true)
    expect(retry(2, new ApiError(503, 'Unavailable'))).toBe(false)
  })

  it('does not ask again when the API refused the request', () => {
    expect(retry(0, new ApiError(404, 'Not found'))).toBe(false)
    expect(retry(0, new ApiError(401, 'Not signed in'))).toBe(false)
  })
})
