import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './return-to'

describe('safeReturnTo', () => {
  it('keeps a page of this app', () => {
    expect(safeReturnTo('/WEB/boards/1?x=1')).toBe('/WEB/boards/1?x=1')
  })

  it('goes to the project list when there is nowhere to return to', () => {
    expect(safeReturnTo(null)).toBe('/projects')
    expect(safeReturnTo('')).toBe('/projects')
  })

  it('refuses addresses that lead to other websites', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeReturnTo(value)).toBe('/projects')
    }
  })
})
