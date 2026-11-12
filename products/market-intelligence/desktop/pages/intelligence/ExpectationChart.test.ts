import { describe, expect, it } from 'vitest'

import { formatTick } from './ExpectationChart'

describe('expectation chart ticks', () => {
  it('keeps the minus sign on the lower half of the axis', () => {
    expect([-40, -20, 0, 20, 40].map(formatTick)).toEqual(['−40bp', '−20bp', '0bp', '+20bp', '+40bp'])
  })
})
