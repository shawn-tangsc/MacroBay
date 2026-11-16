import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { isMarketCalendarFreshness } from '../../../contracts/macro/marketCalendarQueryContracts'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { readCalendarFreshnessFromJobRuns, readStandardTableLastWrittenAt } from './marketCalendarFreshnessFromJobs'

/**
 * 公共读数的**形状守卫**：读取器真实返回值必须过 `isMarketCalendarFreshness`。
 * 这条在今天以前会红——返回值多了一个诊断字段 `lastRunAt`，而契约用精确键集校验，多一个键整份
 * 作废，简报只能显示「自动同步已停止」。以后谁再往这份读数里加字段，这条先红。
 */
it('the reader\'s real value passes the public contract check', () => {
  const value = readCalendarFreshnessFromJobRuns({
    lastWrittenAt: '2026-11-14T03:00:00.000Z', asOf: '2026-11-14T05:00:00.000Z',
    latestAttempts: [{ descriptorId: 'macro-calendar-0xrouter-economic-data',
      latestAttempt: { attemptedAt: '2026-11-14T04:00:00.000Z', state: 'succeeded' } }]
  })
  expect(isMarketCalendarFreshness(value)).toBe(true)
})

/**
 * **口径变更（用户 2026-11-16 定死）**：判定只读 `max(observed_at)`，不看作业跑没跑。
 * 原来这里断的是「作业跑成就算新」——那条口径已被推翻：数据没写进去就是旧的，
 * 不能拿「作业跑过」替它作保。改断言不是放宽，是行为变了（对应「68 小时」那次事故）。
 */
describe('新鲜度：只认标准表里最后一次真正写入', () => {
  it('源安静没写新行 → 按写入时刻判，不拿「作业跑成」顶替', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      lastWrittenAt: '2026-11-11T04:00:00.000Z', asOf: '2026-11-14T05:00:00.000Z'
    })
    expect(freshness.lastCollectedAt).toBe('2026-11-11T04:00:00.000Z')
    expect(freshness).not.toHaveProperty('lastRunAt')
    expect(freshness.sources.every((source) => source.lastCollectedAt === '2026-11-11T04:00:00.000Z')).toBe(true)
  })

  it('从没写过数据 → 采集时刻为空（事实），不是失败', () => {
    const freshness = readCalendarFreshnessFromJobRuns({ lastWrittenAt: null, asOf: '2026-11-14T05:00:00.000Z' })
    expect(freshness.lastCollectedAt).toBeNull()
    expect(freshness.sources).toHaveLength(3)
  })

  it('三条来源共用同一个时刻；`latestAttempt` 只作展示，不改判定值', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      lastWrittenAt: '2026-11-14T04:00:00.000Z', asOf: '2026-11-14T05:00:00.000Z',
      latestAttempts: [{ descriptorId: 'macro-calendar-0xrouter-financial-events',
        latestAttempt: { attemptedAt: '2026-11-14T04:59:00.000Z', state: 'failed' } }]
    })
    expect(new Set(freshness.sources.map((source) => source.lastCollectedAt)).size).toBe(1)
    expect(freshness.sources.some((source) => source.latestAttempt?.state === 'failed')).toBe(true)
    expect(freshness.lastCollectedAt).toBe('2026-11-14T04:00:00.000Z')
  })
})

describe('数据写入时刻取自标准表', () => {
  it('表还没建 → null（没有数据这个事实，不是读不到）', () => {
    expect(readStandardTableLastWrittenAt(new DatabaseSync(':memory:'))).toBeNull()
  })

  it('取 max(observed_at)：多次写入看最新那一次', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    for (const [observedAt, eventId] of [['2026-11-12T00:00:00.000Z', 'r-1'], ['2026-11-14T05:00:00.000Z', 'r-2']] as const) {
      upsertCalendarStandardRow(database, {
        countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', scheduledDate: '2026-11-14',
        timePrecision: 'date', valuesJson: '{}', sourceProviderId: 'narwhal', sourceEventId: eventId,
        parserVersion: 'v1', observedAt, firstSeenAt: observedAt
      })
    }
    expect(readStandardTableLastWrittenAt(database)).toBe('2026-11-14T05:00:00.000Z')
  })
})
