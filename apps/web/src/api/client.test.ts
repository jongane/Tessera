import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, server } from '../test/server'
import { api, ApiError } from './client'

describe('api', () => {
  it('sends JSON and reads the answer', async () => {
    server.use(
      http.post('/api/things', async ({ request }) =>
        HttpResponse.json({ got: await request.json() }),
      ),
    )

    await expect(api('/things', { method: 'POST', body: { a: 1 } })).resolves
      .toEqual({ got: { a: 1 } })
  })

  it('answers undefined when there is nothing to send back', async () => {
    server.use(
      http.delete('/api/things/1', () => new HttpResponse(null, { status: 204 })),
    )

    await expect(api('/things/1', { method: 'DELETE' })).resolves.toBe(
      undefined,
    )
  })

  it('turns a refusal into an ApiError with the API’s message', async () => {
    server.use(http.get('/api/things', () => apiError(403, 'Admins only')))

    const error = await api('/things').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, message: 'Admins only' })
  })

  it('explains when the API cannot be reached', async () => {
    server.use(http.get('/api/things', () => HttpResponse.error()))

    await expect(api('/things')).rejects.toMatchObject({
      status: 0,
      message: 'Tessera could not be reached. Check your connection and try again.',
    })
  })
})
