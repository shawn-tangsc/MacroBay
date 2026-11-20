import { describe, expect, it } from 'vitest'

import { projectReaderVisibleEvents } from './macroCalendarReaderProjection'

const event = (providerIds: readonly string[], eventKey: string) => ({ providerIds, eventKey })

describe('reader-visible official events', () => {
  it('keeps a shell out of the reader list while its only source cannot be read', () => {
    // 11-10「核心 CPI」：BLS 那行没有时刻、没有实际值，主列表却让它占着一格。
    const shell = event(['macro-calendar-bls'], 'bls-core-cpi')
    const provider = event(['macro-calendar-0xrouter-economic-data'], '0xrouter-core-cpi')
    expect(projectReaderVisibleEvents([shell, provider], true)).toEqual([provider])
  })

  it('keeps an event another source also reports, and one with no source at all', () => {
    // 同一件事只要还有一家说得出时刻与数值，就不能因为「BLS 读不到」被一起藏掉。
    const shared = event(['macro-calendar-bls', 'macro-calendar-fed'], 'fomc-note')
    const unknown = event([], 'no-provider')
    expect(projectReaderVisibleEvents([shared, unknown], true)).toEqual([shared, unknown])
  })

  it('puts BLS rows back as soon as it is readable again', () => {
    // 判据读的是可用性状态，不是一张写死的名单：切回可用，BLS 那行原样回来。
    const shell = event(['macro-calendar-bls'], 'bls-core-cpi')
    expect(projectReaderVisibleEvents([shell], false)).toEqual([shell])
  })
})
