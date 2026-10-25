import { describe, expect, it } from 'vitest'

import { isRoutineNewsNotice } from './newsSentimentRules'

describe('isRoutineNewsNotice', () => {
  it('drops neutral low-strength maintenance notices', () => {
    expect(isRoutineNewsNotice({ title: 'OKX to Perform Scheduled Maintenance on the RFQ System', polarity: 'neutral', strength: 1 })).toBe(true)
    expect(isRoutineNewsNotice({ title: 'API upgrade window on October 22', polarity: 'neutral', strength: 2 })).toBe(true)
  })

  it('keeps directional or severe operational events', () => {
    expect(isRoutineNewsNotice({ title: 'OKX will suspend withdrawals', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'System maintenance caused a 6-hour outage', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Exchange lists new perpetual contract', polarity: 'bullish', strength: 3 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Protocol upgrade scheduled', polarity: 'neutral', strength: 1 })).toBe(false)
  })
})
