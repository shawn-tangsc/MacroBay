import { describe, expect, it } from 'vitest'

import type { NewsSentimentRecord } from '../schema/newsSentiment'
import { readSentimentTestCandidate, sentimentTestCandidate, sentimentTestWindow } from './newsSentimentTestCandidate'
import { createNewsSentimentSqliteStore } from './newsSentimentStore'

// Asia/Shanghai 的 2026-11-08 04:00；「最近 7 天」的起点因此是 11-02 00:00 = 11-01T16:00Z。
const NOW = '2026-11-07T20:00:00.000Z'
const ZONE = 'Asia/Shanghai'

function row(itemId: string, publishedAt: string, strength: number, sourceId = 'coindesk-rss'): NewsSentimentRecord {
  return {
    itemId,
    sourceId,
    publishedAt,
    scoredAt: publishedAt,
    polarity: 'bearish',
    strength,
    confidence: 80,
    symbols: [],
    reasonCode: 'news.rule.v1',
    engine: 'model',
    caveats: []
  }
}

const items = [
  { itemId: 'outside', title: '窗外那条', url: 'https://example.com/outside' },
  { itemId: 'boundary', title: '日界那条', url: 'https://example.com/boundary' },
  { itemId: 'newest', title: '最新那条', url: 'https://example.com/newest' },
  { itemId: 'stronger', title: '更早但更强', url: 'https://example.com/stronger' },
  { itemId: 'a', title: '同刻 a', url: 'https://example.com/a' },
  { itemId: 'b', title: '同刻 b', url: 'https://example.com/b' }
]

const base = { now: NOW, timeZone: ZONE, source: 'available' as const, items, readComplete: true }

describe('the test button’s sentiment sample', () => {
  it('starts the window at the reader’s local midnight, so the row just outside is not chosen', () => {
    const outside = row('outside', '2026-11-01T15:59:59.999Z', 5) // 本地 11-01 23:59:59.999
    const boundary = row('boundary', '2026-11-01T16:00:00.000Z', 5) // 本地 11-02 00:00
    expect(sentimentTestWindow({ now: NOW, timeZone: ZONE })).toEqual({
      from: '2026-11-01T16:00:00.000Z',
      to: NOW
    })
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [outside, boundary] }))
      .toMatchObject({ kind: 'candidate', itemId: 'boundary' })
    // 只有窗外那条时，答案是「没有」，不是把窗外那条捞进来凑数。
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [outside] })).toEqual({ kind: 'none' })
  })

  it('takes the newest qualifying row, not the strongest one', () => {
    const stronger = row('stronger', '2026-11-06T12:00:00.000Z', 5)
    const newest = row('newest', '2026-11-07T10:00:00.000Z', 3)
    expect(sentimentTestCandidate({ ...base, threshold: 'medium', rows: [stronger, newest] }))
      .toMatchObject({ kind: 'candidate', itemId: 'newest', strength: 3, tier: 'medium' })
    // 门槛是「档位 ≥ 门槛」：抬到高以后，那条中档的就不再合格。
    expect(sentimentTestCandidate({ ...base, threshold: 'high', rows: [stronger, newest] }))
      .toMatchObject({ kind: 'candidate', itemId: 'stronger', strength: 5, tier: 'high' })
  })

  it('breaks a same-instant tie by the smallest item id', () => {
    const at = '2026-11-06T12:00:00.000Z'
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [row('b', at, 4), row('a', at, 4)] }))
      .toMatchObject({ kind: 'candidate', itemId: 'a' })
  })

  it('keeps “nothing qualifying”, “sources off” and “cannot read” as three answers', () => {
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [] })).toEqual({ kind: 'none' })
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [], source: 'disabled' }))
      .toEqual({ kind: 'source-disabled' })
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [], source: 'unreadable' }))
      .toEqual({ kind: 'unreadable' })
    // 时区坏掉是第四种，且不许退回 UTC 后按 UTC 的日界挑数据。
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [row('newest', '2026-11-06T12:00:00.000Z', 4)], timeZone: 'Not/AZone' }))
      .toEqual({ kind: 'timezone-unreadable' })
  })

  it('skips a judgment with no pipeline item: there is no real title to send', () => {
    expect(sentimentTestCandidate({ ...base, threshold: 'low', rows: [row('ghost', '2026-11-06T12:00:00.000Z', 5)] }))
      .toEqual({ kind: 'none' })
  })

  it('never claims “none” from a read the store truncated', () => {
    // 500 行是存储一次能回的上限；读满时窗口里可能还有更早的合格条目。
    const full = Array.from({ length: 500 }, (_, index) =>
      row(`filler-${index}`, '2026-11-06T00:00:00.000Z', 1)
    )
    expect(sentimentTestCandidate({ ...base, threshold: 'high', rows: full, readComplete: false }))
      .toEqual({ kind: 'unreadable' })
    // 截断位置正好落在选中那一秒：同刻更小的 id 可能还没读到，也不许猜。行序也不参与判断。
    const cutAtBest = [...full.slice(1), row('newest', '2026-11-06T00:00:00.000Z', 5)]
    expect(sentimentTestCandidate({ ...base, threshold: 'high', rows: cutAtBest, readComplete: false }))
      .toEqual({ kind: 'unreadable' })
  })
})

describe('reading the sentiment sample', () => {
  const itemsInPipeline = [
    { itemId: 'item-old', title: '旧闻', url: 'https://example.com/old' },
    { itemId: 'item-new', title: '新闻', url: 'https://example.com/new' }
  ]

  function sqliteStore() {
    // 用真实存储的形状跑一遍「读最新一条判断」的路径，但只写内存库。
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertSentiment({ ...row('item-old', '2026-11-05T00:00:00.000Z', 5), reasonCode: 'news.old.v1' })
    store.upsertSentiment({ ...row('item-new', '2026-11-07T00:00:00.000Z', 3), reasonCode: 'news.new.v1' })
    return store
  }

  it('reads the reader-zone window and hands back the newest row above the configured threshold', async () => {
    const store = sqliteStore()
    const calls: Array<{ from: string; to: string; limit?: number }> = []
    const candidate = await readSentimentTestCandidate({
      store: { listLatestSentiment: (input) => { calls.push(input); return store.listLatestSentiment(input) } },
      pipeline: { listItems: () => itemsInPipeline as never },
      readEnabledSourceIds: async () => ['coindesk-rss'],
      readThreshold: () => 'medium',
      getTimeZone: () => ZONE,
      now: () => NOW
    })
    expect(calls).toEqual([{ from: '2026-11-01T16:00:00.000Z', to: NOW, limit: 500 }])
    expect(candidate).toMatchObject({
      kind: 'candidate',
      itemId: 'item-new',
      title: '新闻',
      sourceName: 'CoinDesk RSS',
      publishedAt: '2026-11-07T00:00:00.000Z',
      strength: 3,
      tier: 'medium'
    })
  })

  it('says the sources are off without touching the store', async () => {
    let read = false
    const candidate = await readSentimentTestCandidate({
      store: { listLatestSentiment: () => { read = true; return [] } },
      pipeline: { listItems: () => [] },
      readEnabledSourceIds: async () => ['macro-calendar-fomc'],
      readThreshold: () => 'low',
      getTimeZone: () => ZONE,
      now: () => NOW
    })
    expect(candidate).toEqual({ kind: 'source-disabled' })
    expect(read).toBe(false)
  })

  it('turns every unreadable step into unreadable, never into “no data”', async () => {
    const deps = {
      store: { listLatestSentiment: () => { throw new Error('db locked') } },
      pipeline: { listItems: () => itemsInPipeline as never },
      readEnabledSourceIds: async () => ['coindesk-rss'],
      readThreshold: () => 'low' as const,
      getTimeZone: () => ZONE,
      now: () => NOW
    }
    await expect(readSentimentTestCandidate(deps)).resolves.toEqual({ kind: 'unreadable' })
    await expect(readSentimentTestCandidate({ ...deps, readEnabledSourceIds: async () => { throw new Error('profiles') } }))
      .resolves.toEqual({ kind: 'unreadable' })
    await expect(readSentimentTestCandidate({ ...deps, getTimeZone: () => { throw new Error('no zone') } }))
      .resolves.toEqual({ kind: 'timezone-unreadable' })
    await expect(readSentimentTestCandidate({ ...deps, getTimeZone: () => '' }))
      .resolves.toEqual({ kind: 'timezone-unreadable' })
  })
})
