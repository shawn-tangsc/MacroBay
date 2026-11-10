import { describe, expect, it, vi } from 'vitest'

import { createBriefingPeriodStore } from './dailyBriefingPeriodStore'
import { readConfiguredBriefingPeriods } from './dailyBriefingPeriodSettingsReader'

const memory = (initial: unknown) => {
  let stored = initial
  return { read: vi.fn(async () => stored), write: vi.fn(async (next) => { stored = next }) }
}

describe('period configuration reader (S7a, capability only)', () => {
  it('reads the configured periods from the period store', async () => {
    const store = createBriefingPeriodStore({
      storage: memory({ version: 1, periods: [{ id: 'default', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }] }),
      defaultLanguage: () => 'zh-CN'
    })
    expect(await readConfiguredBriefingPeriods(store, 'en-US')).toMatchObject([
      { id: 'default', generationTime: '08:00', language: 'zh-CN' }
    ])
  })

})
