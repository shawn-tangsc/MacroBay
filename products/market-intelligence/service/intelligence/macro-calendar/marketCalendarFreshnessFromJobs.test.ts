import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { isMarketCalendarFreshness } from '../../../contracts/macro/marketCalendarQueryContracts'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { readCalendarFreshnessFromJobRuns, readStandardTableLastWrittenAt } from './marketCalendarFreshnessFromJobs'

const runs = (completed: string[]) => (query: { definitionId: string }) =>
  (completed.includes(query.definitionId) ? [{ status: 'completed', completedAt: completed[0]! }] : [])

/**
 * 公共读数的**形状守卫**：读取器真实返回值必须过 `isMarketCalendarFreshness`。
 * 这条在今天以前会红——返回值多了一个诊断字段 `lastRunAt`，而契约用精确键集校验，多一个键整份
 * 作废，简报只能显示「自动同步已停止」。以后谁再往这份读数里加字段，这条先红。
 */
it('the reader\'s real value passes the public contract check', () => {
  const value = readCalendarFreshnessFromJobRuns({
    listRuns: () => [{ status: 'completed', completedAt: '2026-11-14T04:00:00.000Z' }],
    lastWrittenAt: '2026-11-14T03:00:00.000Z',
    asOf: '2026-11-14T05:00:00.000Z'
  })
  expect(isMarketCalendarFreshness(value)).toBe(true)
})

describe('新鲜度：只看作业跑成没跑成', () => {
  it('作业一直成功、但源安静没写新行 → 不算过期（源没有新数据 ≠ 采集失败）', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      listRuns: () => [{ status: 'completed', completedAt: '2026-11-14T04:00:00.000Z' }],
      lastWrittenAt: '2026-11-11T04:00:00.000Z',
      asOf: '2026-11-14T05:00:00.000Z'
    })
    // 采集时刻取**作业跑成**那一刻：源安静不写新行，界面不能因此写成「过期」。
    expect(freshness.lastCollectedAt).toBe('2026-11-14T04:00:00.000Z')
    // 诊断字段**不进这份返回值**（公共读数精确键集）：要「跑没跑」就单独算，别塞进公共契约。
    expect(freshness).not.toHaveProperty('lastRunAt')
    expect(freshness.sources.every((source) => source.lastCollectedAt === '2026-11-14T04:00:00.000Z')).toBe(true)
  })

  it('从没写过数据 → 采集时刻为空（事实），不是失败；运行时刻照报', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      listRuns: runs(['market-intelligence.refreshNarwhalCalendarTick.automatic']),
      lastWrittenAt: null, asOf: '2026-11-14T05:00:00.000Z'
    })
    expect(freshness.lastCollectedAt).not.toBeNull()   // 退回运行时刻：读过但没写，也算跑过
    expect(freshness.sources).toHaveLength(3)
  })

  it('失败的运行不算成功；三条来源共用同一个时刻（一次采集三类事件，不编三个时刻）', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      listRuns: () => [{ status: 'failed', completedAt: '2026-11-14T04:00:00.000Z' }],
      lastWrittenAt: null, asOf: '2026-11-14T05:00:00.000Z'
    })
    expect(freshness).not.toHaveProperty('lastRunAt')
    expect(new Set(freshness.sources.map((source) => source.lastCollectedAt)).size).toBe(1)
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
