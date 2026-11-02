import { describe, expect, it } from 'vitest'
import { estimateFrom } from './estimate'

describe('estimateFrom', () => {
  it('turns hours and minutes into minutes', () => {
    expect(estimateFrom({ hours: '1', minutes: '30' })).toBe(90)
    expect(estimateFrom({ hours: '2', minutes: '' })).toBe(120)
    expect(estimateFrom({ hours: '', minutes: '45' })).toBe(45)
  })

  it('gives null when both boxes are empty', () => {
    expect(estimateFrom({ hours: ' ', minutes: '' })).toBe(null)
  })

  it('says what is wrong', () => {
    expect(estimateFrom({ hours: '1.5', minutes: '' })).toBe(
      'Use whole numbers',
    )
    expect(estimateFrom({ hours: '-1', minutes: '' })).toBe('Use whole numbers')
    expect(estimateFrom({ hours: '1', minutes: '60' })).toBe(
      'Minutes go up to 59',
    )
    expect(estimateFrom({ hours: '10001', minutes: '' })).toBe(
      'Use at most 10000 hours',
    )
  })
})
