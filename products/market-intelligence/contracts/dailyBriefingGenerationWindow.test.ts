import { describe, expect, it } from 'vitest'

import { earliestManualGenerationDate, isManualGenerationDateAllowed } from './dailyBriefingGenerationWindow'

describe('manual generation is limited to the last three days', () => {
  // 用户 2026-11-06：手动生成只允许最近 3 天（含今天），超窗不给选、服务端也拒。
  const today = '2026-11-06'

  it('allows today and each of the previous three days', () => {
    for (const date of ['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03']) {
      expect(isManualGenerationDateAllowed(date, today), date).toBe(true)
    }
    expect(earliestManualGenerationDate(today)).toBe('2026-11-03')
  })

  it('refuses the fourth day back and anything older', () => {
    expect(isManualGenerationDateAllowed('2026-11-02', today)).toBe(false)
    expect(isManualGenerationDateAllowed('2026-10-01', today)).toBe(false)
  })

  it('refuses a future date', () => {
    expect(isManualGenerationDateAllowed('2026-11-07', today)).toBe(false)
  })

  it('crosses a month boundary without arithmetic on local time', () => {
    expect(earliestManualGenerationDate('2026-12-01')).toBe('2026-11-28')
    expect(isManualGenerationDateAllowed('2026-11-28', '2026-12-01')).toBe(true)
    expect(isManualGenerationDateAllowed('2026-11-27', '2026-12-01')).toBe(false)
  })
})
