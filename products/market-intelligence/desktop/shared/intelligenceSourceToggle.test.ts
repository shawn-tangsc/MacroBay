import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setCalendarEnabled: vi.fn(async () => ({ ok: true })),
  setEnabled: vi.fn(async () => ({}))
}))

vi.mock('./ipc/intelligenceSourcesClient', () => ({
  intelligenceSourcesClient: { setCalendarEnabled: mocks.setCalendarEnabled, setEnabled: mocks.setEnabled }
}))

import { setSourceEnabled } from './intelligenceSourceToggle'

describe('setSourceEnabled', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('routes official calendars to the provider profile', async () => {
    await setSourceEnabled({ sourceId: 'macro-calendar-fed', kind: 'official-calendar' }, true)
    expect(mocks.setCalendarEnabled).toHaveBeenCalledWith('macro-calendar-fed', true)
    expect(mocks.setEnabled).not.toHaveBeenCalled()
  })

  it('routes ordinary sources to the intelligence source service', async () => {
    await setSourceEnabled({ sourceId: 'alternative-fear-greed', kind: 'feed' }, true)
    expect(mocks.setEnabled).toHaveBeenCalledWith('alternative-fear-greed', true)
    expect(mocks.setCalendarEnabled).not.toHaveBeenCalled()
  })

  it('persists product-scheduled market calendar switches through the calendar endpoint', async () => {
    await setSourceEnabled({ sourceId: 'macro-calendar-0xrouter-economic-data', kind: 'market-calendar' }, true)
    expect(mocks.setCalendarEnabled).toHaveBeenCalledWith('macro-calendar-0xrouter-economic-data', true)
    expect(mocks.setEnabled).not.toHaveBeenCalled()
  })
})
