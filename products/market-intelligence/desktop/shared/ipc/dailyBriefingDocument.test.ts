import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { isDocument } from './dailyBriefingDocument'

/**
 * The renderer refuses a document it does not fully understand. Schema 13 adds the period identity,
 * so the guard has to do two things at once: require the three fields on a 13 document, and keep
 * accepting the older rows that never had them — refusing those would erase every edition already
 * stored on the reader's machine.
 */
const document = (overrides: Partial<DailyBriefingDocument['edition']> = {}): DailyBriefingDocument => ({
  schemaVersion: 13,
  policyVersion: 'daily-briefing.v23',
  edition: {
    date: '2026-10-30',
    locale: 'zh-CN',
    generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z',
    windowEnd: '2026-10-30T00:30:00.000Z',
    timeZone: 'Asia/Shanghai',
    windowHours: 24,
    periodId: 'default',
    periodTime: '2026-10-30T00:30:00.000Z',
    periodKind: 'scheduled',
    runTrigger: 'scheduled',
    ...overrides
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' },
      { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' },
      { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4,
    readingsTotal: 4
  },
  lede: { source: 'template', text: '今日要点。', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: {
    market: [],
    funds: [],
    sentiment: { fearGreed: null, news: { state: 'empty' } }
  },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' }
})

const withoutPeriod = (): DailyBriefingDocument => {
  const value = document()
  const { periodId: _id, periodTime: _time, periodKind: _kind, runTrigger: _trigger, ...edition } = value.edition
  return { ...value, edition }
}

describe('daily briefing document guard at schema 13', () => {
  it('accepts a 13 document that carries the full period identity', () => {
    expect(isDocument(document())).toBe(true)
    expect(isDocument(document({ periodKind: 'manual', periodId: 'period_01J8Z6Q4T3', runTrigger: 'manual' }))).toBe(true)
    for (const trigger of ['scheduled', 'catch-up', 'retry', 'auto-retry', 'manual'] as const) {
      expect(isDocument(document({ runTrigger: trigger })), trigger).toBe(true)
    }
  })

  it('refuses a 13 document that is missing any of the four fields', () => {
    for (const field of ['periodId', 'periodTime', 'periodKind', 'runTrigger'] as const) {
      const value = document()
      const edition = { ...value.edition }
      delete (edition as Record<string, unknown>)[field]
      expect(isDocument({ ...value, edition }), field).toBe(false)
    }
    expect(isDocument(document({ periodKind: undefined as unknown as 'scheduled' }))).toBe(false)
  })

  it('refuses an unknown period kind and an empty opaque id', () => {
    expect(isDocument(document({ periodKind: 'retro' as unknown as 'scheduled' }))).toBe(false)
    expect(isDocument(document({ runTrigger: 'catchup' as unknown as 'scheduled' }))).toBe(false)
    expect(isDocument(document({ periodId: '' }))).toBe(false)
  })

  it('refuses a nominal cutoff that is not an ISO instant with milliseconds', () => {
    // A11.4 is about the stored precision, so the guard has to be the judge: a second-precision
    // value must not pass just because it is a non-empty string.
    for (const periodTime of [
      '2026-11-05T07:00:00Z',
      '2026-11-05T07:00:00.00Z',
      '2026-11-05T07:00:00.000+00:00',
      '2026-11-05 07:00:00.000Z',
      '2026-13-05T07:00:00.000Z'
    ]) {
      expect(isDocument(document({ periodTime })), periodTime).toBe(false)
    }
    expect(isDocument(document({ periodTime: '2026-11-05T07:00:00.000Z' }))).toBe(true)
  })

  it('keeps accepting rows written before 13, which never had the fields', () => {
    const old = { ...withoutPeriod(), schemaVersion: 12 as const }
    expect(isDocument(old)).toBe(true)
  })

  it('refuses a pre-13 row with only part of the identity, instead of guessing the rest', () => {
    const old = withoutPeriod()
    expect(isDocument({ ...old, schemaVersion: 12, edition: { ...old.edition, periodId: 'default' } })).toBe(false)
  })

  it('accepts the current schema row and refuses only a version past it', () => {
    // 文档落库后必须被自己读回来：守卫只拒绝「比现在更新」的版本。
    const current = { ...document(), schemaVersion: 15 as const, policyVersion: 'daily-briefing.v24' as const }
    expect(isDocument(current)).toBe(true)
    expect(isDocument({ ...current, schemaVersion: 16 as unknown as 15 })).toBe(false)
  })

  it('carries the news-source list a schema-15 edition froze, and refuses an unknown state', () => {
    const current = { ...document(), schemaVersion: 15 as const, policyVersion: 'daily-briefing.v25' as const }
    const silent = { sourceId: 'coindesk-rss', name: 'CoinDesk RSS', state: 'silent', lastNewItemAt: '2026-10-29T01:30:00.000Z', silentHours: 25 }
    const withSources = { ...current, news: { ...current.news, sources: [silent] } }
    expect(isDocument(withSources)).toBe(true)
    // 状态是闭集：猜出来的第三种状态一律拒绝，不让它混进来。
    expect(isDocument({ ...withSources, news: { ...withSources.news, sources: [{ ...silent, state: 'quiet' }] } })).toBe(false)
  })

  it('ignores unknown fields instead of rejecting the whole document', () => {
    // `02` v2.129 `G5`：服务端加字段不许把"成功"显示成"失败"。未知字段一律忽略；
    // 只有版本号比当前更高才拒（那是真的读不懂）。
    const current = { ...document(), schemaVersion: 15 as const, policyVersion: 'daily-briefing.v24' as const }
    expect(isDocument({
      ...current,
      edition: { ...current.edition, readAt: '2026-11-06T00:00:00.000Z', generatedAs: '2026-11-06T00:00:00.000Z', isBackfill: false, futureField: 1 }
    })).toBe(true)
  })
})
