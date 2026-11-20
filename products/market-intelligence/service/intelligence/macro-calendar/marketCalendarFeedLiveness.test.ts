import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  calendarFeedLivenessPolicy, feedLiveness, providerIntervalSeconds, readProviderLastBatches
} from './marketCalendarFeedLiveness'

/**
 * 「这条源还在出数吗」的判据：**按采集批次判，不按事件上的时刻判**。
 *
 * 用户 2026-11-16 定的起因：Narwhal 自 11-13T13:20Z 之后再没产出，界面一路显示正常，直到读者
 * 拿着错的预期值（10，实际 18）来问。判据要能在「静默」这件事上开口，而不是等人发现数不对。
 *
 * 这里钉三件事：
 * 1. 连续错过 N 个**自己的**周期才算停（官方 6 小时与市场源 30 分钟不能套同一个数）；
 * 2. 从来没有成功批次 → **不是**「已停止出数」（没跑过与停下来是两件事）；
 * 3. 批次表读不到（新库）→ 什么都不判，不许把「读不到」写成「全都停了」。
 */
describe('calendar feed liveness', () => {
  const asOf = '2026-11-16T13:52:00.000Z'
  const narwhalInterval = 30 * 60

  it('reports silence once the feed has missed several of its own intervals', () => {
    // 三天没有任何批次：远超 3 个 30 分钟周期。
    const silent = feedLiveness({
      feedId: 'macro-calendar-narwhal-economic-data', providerId: 'narwhal', intervalSeconds: narwhalInterval,
      batches: new Map([['narwhal', '2026-11-13T13:20:07.915Z']]), asOf
    })
    expect(silent).toEqual({
      feedId: 'macro-calendar-narwhal-economic-data',
      lastBatchAt: '2026-11-13T13:20:07.915Z',
      silent: true
    })

    // 恢复一批 → 回正常。
    const recovered = feedLiveness({
      feedId: 'macro-calendar-narwhal-economic-data', providerId: 'narwhal', intervalSeconds: narwhalInterval,
      batches: new Map([['narwhal', '2026-11-16T13:50:00.000Z']]), asOf
    })
    expect(recovered.silent).toBe(false)
    expect(recovered.lastBatchAt).toBe('2026-11-16T13:50:00.000Z')
  })

  it('judges each feed against its own interval, not one hard-coded hour count', () => {
    // 批次按 **provider** 记（一个 provider 一轮采一批），不是按 feed。
    const batches = new Map([['bls', '2026-11-16T09:00:00.000Z']])
    // 官方日程 6 小时一轮：4 小时前的一批还没到「停」。
    expect(feedLiveness({ feedId: 'macro-calendar-bls', providerId: 'bls', intervalSeconds: 6 * 60 * 60, batches, asOf }).silent).toBe(false)
    // 同一批按 30 分钟的周期看，已经错过 8 轮。
    expect(feedLiveness({ feedId: 'macro-calendar-bls', providerId: 'bls', intervalSeconds: 30 * 60, batches, asOf }).silent).toBe(true)
    expect(calendarFeedLivenessPolicy.silentAfterIntervals).toBe(3)
  })

  it('never calls a feed that has never succeeded "stopped"', () => {
    expect(feedLiveness({
      feedId: 'macro-calendar-narwhal-economic-data', providerId: 'narwhal', intervalSeconds: narwhalInterval,
      batches: new Map(), asOf
    })).toEqual({ feedId: 'macro-calendar-narwhal-economic-data', lastBatchAt: null, silent: false })
  })

  it('reads the newest successful batch per provider, and treats a missing table as nothing to judge', () => {
    const database = new DatabaseSync(':memory:')
    try {
      // 新库：表还没建——不许抛，也不许把「读不到」读成「全都停了」。
      expect(readProviderLastBatches(database).size).toBe(0)

      database.exec(`create table mi_macro_calendar_market_event_collections (
        provider_id text not null, status text not null, detected_at text)`)
      database.exec(`insert into mi_macro_calendar_market_event_collections values
        ('narwhal', 'success', '2026-11-13T13:20:07.915Z'),
        ('narwhal', 'failed',  '2026-11-16T13:40:00.000Z'),
        ('0xrouter','success', '2026-11-16T13:24:19.451Z')`)
      const batches = readProviderLastBatches(database)
      // 失败批次不算成功：narwhal 的时刻仍是 11-13，不会被一次失败「刷新」。
      expect(batches.get('narwhal')).toBe('2026-11-13T13:20:07.915Z')
      expect(batches.get('0xrouter')).toBe('2026-11-16T13:24:19.451Z')
    } finally { database.close() }
  })

  it('takes the interval from the registry, and gives none for a provider that only registers', () => {
    expect(providerIntervalSeconds('narwhal')).toBe(30 * 60)
    expect(providerIntervalSeconds('0xrouter')).toBe(30 * 60)
    // 登记了但没有排期的源（例如只做人工导入的）→ 不下判据，也不猜一个默认周期。
    expect(providerIntervalSeconds('coinmarketcal')).toBeUndefined()
  })
})
