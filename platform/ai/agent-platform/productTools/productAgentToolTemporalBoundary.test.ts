import { describe, expect, it } from 'vitest'

import { validateTemporalBoundary } from './productAgentToolTemporalBoundary'

describe('validateTemporalBoundary', () => {
  it('rejects missing asOf', () => {
    expect(validateTemporalBoundary({})).toEqual({
      ok: false,
      errorCode: 'missing-temporal-boundary',
      message: expect.any(String)
    })
  })

  it('normalizes offset timestamps to UTC ISO', () => {
    const result = validateTemporalBoundary({ asOf: '2026-01-02T10:00:00+08:00' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.asOf).toBe('2026-01-02T02:00:00.000Z')
    }
  })
})
