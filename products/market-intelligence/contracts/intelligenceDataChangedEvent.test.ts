import { describe, expect, it } from 'vitest'

import { parseIntelligenceDataChanged } from './intelligenceDataChangedEvent'

describe('parseIntelligenceDataChanged', () => {
  it('keeps the panels it knows and drops the ones it does not', () => {
    const parsed = parseIntelligenceDataChanged({
      panels: ['dashboard', 'briefing', 'dashboard', 'economic-calendar'],
      sources: ['alternative-fear-greed', 'fred-rates-liquidity']
    })

    expect(parsed).toBeDefined()
    // 先钉数量再逐条：认识的留下、去重，不认识的忽略（发射端多一个面板，不该让看板这边连自己那一半都不读）。
    expect(parsed!.panels).toHaveLength(2)
    expect([...parsed!.panels]).toEqual(['dashboard', 'economic-calendar'])
    expect([...parsed!.sources]).toEqual(['alternative-fear-greed', 'fred-rates-liquidity'])
  })

  it('treats a broken shape as no signal at all', () => {
    // 形状坏掉就整条丢：读方不许因为一条畸形载荷「什么都重读」。
    expect(parseIntelligenceDataChanged(undefined)).toBeUndefined()
    expect(parseIntelligenceDataChanged(null)).toBeUndefined()
    expect(parseIntelligenceDataChanged({ panels: 'dashboard', sources: [] })).toBeUndefined()
    expect(parseIntelligenceDataChanged({ panels: ['dashboard'], sources: 'fred' })).toBeUndefined()
    expect(parseIntelligenceDataChanged({ panels: [2], sources: [] })).toBeUndefined()
    expect(parseIntelligenceDataChanged({ panels: ['dashboard'], sources: [null] })).toBeUndefined()
  })

  it('accepts an empty payload without inventing a panel', () => {
    const parsed = parseIntelligenceDataChanged({ panels: [], sources: [] })
    expect(parsed).toBeDefined()
    expect(parsed!.panels).toHaveLength(0)
  })
})
