import { describe, expect, it } from 'vitest'
import { formatRecordTime } from './format'

describe('formatRecordTime', () => {
  it('formats a production API timestamp for the compact record list', () => {
    expect(formatRecordTime('2026-08-12 15:40:00')).toBe('08-12 15:40')
  })

  it('returns a safe placeholder for an invalid value', () => {
    expect(formatRecordTime('invalid')).toBe('--')
  })

  it('returns a safe placeholder for an empty string', () => {
    expect(formatRecordTime('')).toBe('--')
  })

  it('handles timestamps without seconds', () => {
    expect(formatRecordTime('2026-08-12 15:40')).toBe('08-12 15:40')
  })

  it('keeps leading zeros in month/day', () => {
    expect(formatRecordTime('2026-01-02 08:05:30')).toBe('01-02 08:05')
  })
})
