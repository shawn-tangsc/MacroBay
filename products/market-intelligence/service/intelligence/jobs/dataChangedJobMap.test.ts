import { describe, expect, it } from 'vitest'

import {
  REGISTERED_DATA_CHANGED_HANDLER_IDS,
  intelligenceDataChangedTarget
} from './dataChangedJobMap'

/**
 * 作业 → 影响面的登记表：**每个会登记的产品作业都必须有一条**，查不到就是漏登记（发射器会抛错）。
 * 采集作业的面板与来源从注册表读，不在这里另写一张表。
 */
describe('data-changed 作业登记表', () => {
  it('registers every product job handler (no silent gaps)', () => {
    for (const handlerId of REGISTERED_DATA_CHANGED_HANDLER_IDS) {
      expect(intelligenceDataChangedTarget({ handlerId }), handlerId).toBeDefined()
    }
  })

  it('takes a dashboard source from the registry for the collect job', () => {
    const target = intelligenceDataChangedTarget({
      handlerId: 'market-intelligence.collectSource',
      payload: { sourceId: 'coindesk-rss' }
    })
    expect(target?.panels).toEqual(['dashboard'])
    expect(target?.sources).toEqual(['coindesk-rss'])
  })

  it('takes the calendar panel for a calendar source', () => {
    const target = intelligenceDataChangedTarget({
      handlerId: 'market-intelligence.collectSource',
      payload: { sourceId: 'macro-calendar-fed' }
    })
    // 这个源在注册表里同时供看板与经济日历，面板按注册表给的那一份（不在这里裁）。
    expect(target?.panels).toContain('economic-calendar')
  })

  it('returns undefined for an unregistered handler, so the emitter throws instead of skipping', () => {
    expect(intelligenceDataChangedTarget({ handlerId: 'market-intelligence.not-registered' })).toBeUndefined()
  })

  it('accepts the dynamic market-calendar handler ids by prefix', () => {
    expect(
      intelligenceDataChangedTarget({ handlerId: 'market-intelligence.refreshMarketCalendar.economic-data' })?.panels
    ).toEqual(['economic-calendar'])
  })
})
