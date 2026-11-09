import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { briefingLanguageIdentifiers, briefingLanguageSourceTexts } from './dailyBriefingLanguageIdentifiers'
import { briefingTextBreaches } from './dailyBriefingTextScanner'

const WINDOW_END = '2026-10-30T00:00:00.000Z'

function documentFixture(locale: 'zh-CN' | 'en-US' = 'en-US'): DailyBriefingDocument {
  const importance = { tier: 'must' as const, source: 'rule' as const, reasonCode: 'gap' as const }
  return {
    schemaVersion: 6,
    policyVersion: 'daily-briefing.v17',
    edition: {
      date: '2026-10-30', locale, generatedAt: '2026-10-30T13:00:00.000Z',
      windowStart: '2026-10-29T00:00:00.000Z', windowEnd: WINDOW_END, timeZone: 'Asia/Shanghai'
    },
    status: {
      readings: [
        { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
        { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
      ],
      readingsAvailable: 4, readingsTotal: 4
    },
    lede: { source: 'template', text: 'Stablecoins keep contracting.', generatedAt: '2026-10-30T13:00:00.000Z' },
    news: {
      items: [{
        itemId: 'n1', title: 'Stablecoin supply keeps shrinking', sourceName: 'CoinDesk RSS',
        publishedAt: '2026-10-29T23:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
      }],
      macro: [],
      notes: {}
    },
    data: {
      market: [
        {
          id: 'btc', labelKey: 'dailyBriefing.row.btc', importance,
          state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-29T23:00:00.000Z'
        }
      ],
      leverage: { state: 'unavailable', btc: {}, eth: {} },
      funds: [],
      sentiment: {
        fearGreed: null,
        news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
      }
    },
    conclusion: {
      summaryId: 's1', publishedAt: '2026-10-29T23:00:00.000Z', direction: 'bearish', directions: [],
      summary: 'Stablecoin contraction pulls bids away.', conditions: ['Stablecoins keep contracting'],
      invalidations: [], counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
    },
    next: { items: [] },
    citations: [{ index: 0, refId: 'query:example:BTC:price-return-3d:2026-10-29T00:00:00.000Z', sourceLabel: 'example-source', statement: 'BTC fell 1.1% over three days.', observedAt: '2026-10-29T23:00:00.000Z' }],
    provenance: { summaryId: 's1', readAt: WINDOW_END }
  }
}

function breachesFor(before: DailyBriefingDocument, after: DailyBriefingDocument, locale: 'zh-CN' | 'en-US' = 'en-US') {
  return briefingTextBreaches({
    document: after,
    locale,
    identifiers: briefingLanguageIdentifiers({ before, after }),
    sourceTexts: briefingLanguageSourceTexts(after)
  })
}

describe('the language registry', () => {
  it('treats what the fact layer already wrote as identifiers, so an English edition is clean', () => {
    // 事实层写进去的 i18n 键（`labelKey`）、引用号、来源名都在登记表里：它们不是正文。
    const before = documentFixture()
    expect(breachesFor(before, before)).toEqual([])
    // 反证：不登记就被当正文——`labelKey` 形似英文句子，登记是它被放行的唯一原因。
    expect(briefingTextBreaches({ document: documentFixture('zh-CN'), locale: 'zh-CN' }).map((leaf) => leaf.path))
      .toContain('data.market[0].labelKey')
  })

  it('still scans what the model wrote, and names the path', () => {
    // 反证：模型新写的中文句子不在登记表里——即使同一份文档的标识符全部放行，它也必须被扫到。
    const before = documentFixture()
    const after: DailyBriefingDocument = {
      ...before,
      conclusion: { ...before.conclusion!, summary: '稳定币持续收缩，买盘被抽走。' }
    }
    expect(breachesFor(before, after).map((leaf) => leaf.path)).toEqual(['conclusion.summary'])
  })

  it('lets a quoted source headline keep its original language', () => {
    // 中文版里逐字引用英文新闻标题是允许的（来源数据保留原文）；同一句不是引用时就要被扫到。
    const before = documentFixture('zh-CN')
    const quoted: DailyBriefingDocument = {
      ...before,
      conclusion: { ...before.conclusion!, summary: 'Stablecoin supply keeps shrinking' }
    }
    expect(breachesFor(before, quoted, 'zh-CN')).toEqual([])
    const written: DailyBriefingDocument = {
      ...before,
      conclusion: { ...before.conclusion!, summary: 'Leverage is missing and demand still looks tepid.' }
    }
    expect(breachesFor(before, written, 'zh-CN').map((leaf) => leaf.path)).toEqual(['conclusion.summary'])
  })
})
