import { describe, expect, it } from 'vitest'

import type { BriefingMacroItem, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { snapshotFacts, factSnapshotFromPacket } from './dailyBriefingFactSnapshot'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * 「事件优先」的边界（`02` `A0.12`）：没有实际值的高影响事件**照常显示**，但不进喂给模型的分析素材。
 * 这里只钉那条边界的可查记录——分析素材里少了哪几条、为什么少。
 */

const macroItem = (eventKey: string, actual?: string): BriefingMacroItem => Object.freeze({
  eventKey,
  title: eventKey,
  scheduledAt: '2026-10-29T12:30:00.000Z',
  importance: 'high',
  ...(actual === undefined ? {} : { actual }),
  surprise: { direction: 'consensus-unavailable' as const }
})

const document = (macro: readonly BriefingMacroItem[]): DailyBriefingDocument => ({
  schemaVersion: 6,
  policyVersion: 'daily-briefing.v17',
  edition: {
    date: '2026-10-30', locale: 'en-US', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: { readings: [], readingsAvailable: 0, readingsTotal: 4 },
  lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro, notes: {} },
  data: {
    market: [], funds: [],
    sentiment: { fearGreed: null, news: { state: 'empty', counts: { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 0 } }
  },
  conclusion: undefined as never,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: '', readAt: '2026-10-30T00:30:00.000Z' }
} as unknown as DailyBriefingDocument)

const packet: DailyBriefingFactPacket = {
  asOf: '2026-10-30T00:30:00.000Z', windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z',
  windowHours: 24, locale: 'en-US', timeZone: 'Asia/Shanghai',
  conclusion: null, news: { state: 'empty', items: [] }, calendar: { state: 'available', events: [] },
  readings: {
    fearGreed: { state: 'empty' }, funding: { state: 'empty' }, capital: { state: 'empty' }
  } as never,
  market: {},
  enabled: { fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: true }
}

describe('the analysis snapshot records what it left out', () => {
  it('names every high-impact event whose value was missing, with the reason', () => {
    // 排查视角：分析里少了东西时，要能看见少了哪几条、为什么少。
    const facts = snapshotFacts(
      document([macroItem('US.ADP', '86.0'), macroItem('EU.CPI'), macroItem('US.EIA')]),
      factSnapshotFromPacket(packet)
    ) as { macroAnalysisExcluded: readonly { eventKey: string; reason: string }[] }

    expect(facts.macroAnalysisExcluded).toEqual([
      { eventKey: 'EU.CPI', reason: 'value-missing' },
      { eventKey: 'US.EIA', reason: 'value-missing' }
    ])
    // 有值的那条不在清单里：它进了分析，没什么可备注的。
    expect(facts.macroAnalysisExcluded.map((entry) => entry.eventKey)).not.toContain('US.ADP')
  })

  it('leaves the list empty when every event carries a value', () => {
    const facts = snapshotFacts(
      document([macroItem('US.ADP', '86.0')]),
      factSnapshotFromPacket(packet)
    ) as { macroAnalysisExcluded: readonly unknown[] }
    expect(facts.macroAnalysisExcluded).toEqual([])
  })
})
