import { describe, expect, it } from 'vitest'

import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { normalizationBatchPolicy, selectNormalizationBatch } from './normalizationBatchSelection'

function record(input: Readonly<{
  sourceId: string
  detectedAt: string
  id?: string
  state?: RawIntelligenceRecord['processingState']
}>): RawIntelligenceRecord {
  const id = input.id ?? `raw-${input.sourceId}-${input.detectedAt}`
  return {
    rawRecordId: id,
    sourceId: input.sourceId,
    runId: `run-${id}`,
    detectedAt: input.detectedAt,
    payloadFormat: 'json',
    payloadRefType: 'inline',
    payloadBody: '{}',
    payloadHash: `${id}-hash`,
    sourceDedupeKey: id,
    processingOwner: 'generic-intelligence',
    processingState: input.state ?? 'received',
    parserVersion: 'fixture-v1',
    storageTier: 'hot',
    archiveStatus: 'none'
  }
}

function store(records: RawIntelligenceRecord[]) {
  return {
    listUnprocessed: (limit?: number) => (limit === undefined ? records : records.slice(0, limit))
  }
}

describe('normalizationBatchSelection', () => {
  it('takes the newest records first, so an old stuck batch can no longer hold the window', () => {
    /* 2026-11-21 事故：待办以前按追加顺序取，队头那批（11-19T20:14:59 进来的 100 条）永远排第一，
       里面一条每半小时失败一次的记录就把后面 900 多条一起挡住。 */
    const batch = selectNormalizationBatch(
      store([
        record({ sourceId: 'coindesk-rss', detectedAt: '2026-11-19T20:14:59.000Z', id: 'old-head' }),
        record({ sourceId: 'coindesk-rss', detectedAt: '2026-11-21T06:16:42.000Z', id: 'today' }),
        record({ sourceId: 'binance-spot-market', detectedAt: '2026-11-21T07:50:00.000Z', id: 'bar-latest' })
      ]),
      { limit: 2 }
    )

    expect(batch.map((entry) => entry.rawRecordId)).toEqual(['bar-latest', 'today'])
  })

  it('lets no single high-volume source eat the round, so news still gets a slot', () => {
    /* 实测：队列里 930 条待办有 730 条是行情类（币安 5 分钟 bar 424、恐惧贪婪 217 等）。
       纯按时间倒序取 100 条，第一轮只有 3 条新闻、97 条行情——新闻要三十多个小时才追平。 */
    const records: RawIntelligenceRecord[] = []
    for (let index = 0; index < 200; index += 1) {
      records.push(record({
        sourceId: 'binance-spot-market',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 7, 50) - index * 5 * 60_000).toISOString(),
        id: `bar-${index}`
      }))
    }
    for (let index = 0; index < 30; index += 1) {
      records.push(record({
        sourceId: 'coindesk-rss',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 6, 16) - index * 60 * 60_000).toISOString(),
        id: `news-${index}`
      }))
    }

    const batch = selectNormalizationBatch(store(records), {})
    const fromBars = batch.filter((entry) => entry.sourceId === 'binance-spot-market')
    const fromNews = batch.filter((entry) => entry.sourceId === 'coindesk-rss')

    expect(fromBars).toHaveLength(normalizationBatchPolicy.perSourcePerRound)
    expect(fromNews).toHaveLength(normalizationBatchPolicy.newsPerRound)
    expect(batch).toHaveLength(40)
  })

  it('caps news for the whole round, because every news item costs a fetch and a model call', () => {
    const records: RawIntelligenceRecord[] = []
    for (const sourceId of ['coindesk-rss', 'binance-announcements', 'okx-latest-announcements', 'sec-rss']) {
      for (let index = 0; index < 20; index += 1) {
        records.push(record({
          sourceId,
          detectedAt: new Date(Date.UTC(2026, 10, 21, 7, 0) - index * 60_000).toISOString(),
          id: `${sourceId}-${index}`
        }))
      }
    }

    const batch = selectNormalizationBatch(store(records), {})

    expect(batch).toHaveLength(normalizationBatchPolicy.newsPerRound)
  })

  it('does not cap per source when the round is for one source, but still caps its news', () => {
    /* 采集结束后是按源入队的：那一轮本来就只有一个源，套「每源 20」只会把它的积压拖慢四倍；
       新闻总数上限仍然生效，因为它限制的是每轮的外网请求与模型调用。 */
    const records = Array.from({ length: 60 }, (_, index) =>
      record({
        sourceId: 'coindesk-rss',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 7, 0) - index * 60_000).toISOString(),
        id: `news-${index}`
      })
    )

    const batch = selectNormalizationBatch(store(records), { sourceId: 'coindesk-rss' })

    expect(batch).toHaveLength(normalizationBatchPolicy.newsPerRound)
  })

  it('keeps a single-source metric backlog moving at the full round size', () => {
    const records = Array.from({ length: 60 }, (_, index) =>
      record({
        sourceId: 'binance-spot-market',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 7, 50) - index * 5 * 60_000).toISOString(),
        id: `bar-${index}`
      })
    )

    const batch = selectNormalizationBatch(store(records), { sourceId: 'binance-spot-market', limit: 50 })

    expect(batch).toHaveLength(50)
  })

  it('skips records that are no longer part of the queue and splits ties deterministically', () => {
    const batch = selectNormalizationBatch(
      store([
        record({ sourceId: 'defillama-stablecoins', detectedAt: '2026-11-21T07:00:00.000Z' }),
        record({ sourceId: 'coindesk-rss', detectedAt: '2026-11-21T07:00:00.000Z', id: 'b' }),
        record({ sourceId: 'coindesk-rss', detectedAt: '2026-11-21T07:00:00.000Z', id: 'a' })
      ]),
      {}
    )

    expect(batch.map((entry) => entry.rawRecordId)).toEqual(['a', 'b'])
  })

  it('gives the oldest backlog a slot when the candidate pool is truncated: 500 queued, the oldest is picked', () => {
    /* 0.4.5 #44（用户 2026-11-22）：只按最新取 400 条候选时，第 401 条以后的最旧记录没有任何一轮
       看得到——积压 500 条就等于最旧 100 条永久消失，列表缺一段而没有报错。
       造 480 条行情（较新）+ 20 条很旧的新闻：最旧那条必须在**这一轮**出现。 */
    const records: RawIntelligenceRecord[] = []
    for (let index = 0; index < 480; index += 1) {
      records.push(record({
        sourceId: 'binance-spot-market',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 8, 0) - index * 60_000).toISOString(),
        id: `bar-${index}`
      }))
    }
    for (let index = 0; index < 20; index += 1) {
      records.push(record({
        sourceId: 'coindesk-rss',
        detectedAt: new Date(Date.UTC(2026, 9, 1, 0, 0) - index * 60_000).toISOString(),
        id: `old-news-${index}`
      }))
    }

    const batch = selectNormalizationBatch(store(records), {})

    // 最旧的那条（old-news-19）在池外，只有保底名额能把它带进来。
    expect(batch.map((entry) => entry.rawRecordId)).toContain('old-news-19')
    // 保底不改变主体：最新的一批行情仍然占多数（100 条里 10 条保底 + 90 条最新）。
    expect(batch.filter((entry) => entry.sourceId === 'binance-spot-market').length).toBeGreaterThan(0)
  })

  it('does not let the guarantee change an untruncated round — everything already has a slot', () => {
    // 池子装得下全部待办时插队只会让最新新闻变慢，所以保底只在截断时启用。
    const records: RawIntelligenceRecord[] = []
    for (let index = 0; index < 90; index += 1) {
      records.push(record({
        sourceId: 'binance-spot-market',
        detectedAt: new Date(Date.UTC(2026, 10, 21, 8, 0) - index * 60_000).toISOString(),
        id: `bar-${index}`
      }))
    }
    const oldest = record({ sourceId: 'coindesk-rss', detectedAt: '2026-10-01T00:00:00.000Z', id: 'old-news' })
    records.push(oldest)

    const batch = selectNormalizationBatch(store(records), { limit: 20 })

    expect(batch).toHaveLength(20)
    // 20 条上限被最新的 20 条行情占满，最旧那条这轮不插队（它是下一轮的事，不是永远轮不到）。
    expect(batch.map((entry) => entry.rawRecordId)).not.toContain('old-news')
  })
})