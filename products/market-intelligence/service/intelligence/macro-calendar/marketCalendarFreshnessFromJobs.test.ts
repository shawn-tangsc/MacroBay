import { describe, expect, it } from 'vitest'

import { readCalendarFreshnessFromJobRuns } from './marketCalendarFreshnessFromJobs'

const runs = (completed: string[]) => (query: { definitionId: string }) =>
  (completed.includes(query.definitionId) ? [{ status: 'completed', completedAt: completed[0]! }] : [])

describe('新鲜度：运行时刻与数据写入要分开', () => {
  it('作业「一直成功」但数据没动时，采集时刻取数据写入那一刻（不显示成刚更新）', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      listRuns: () => [{ status: 'completed', completedAt: '2026-11-14T04:00:00.000Z' }],
      lastWrittenAt: '2026-11-11T04:00:00.000Z',
      asOf: '2026-11-14T05:00:00.000Z'
    })
    expect(freshness.lastCollectedAt).toBe('2026-11-11T04:00:00.000Z')   // 数据新旧
    expect(freshness.lastRunAt).toBe('2026-11-14T04:00:00.000Z')          // 跑没跑
    expect(freshness.sources.every((source) => source.lastCollectedAt === '2026-11-11T04:00:00.000Z')).toBe(true)
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
    expect(freshness.lastRunAt).toBeNull()
    expect(new Set(freshness.sources.map((source) => source.lastCollectedAt)).size).toBe(1)
  })
})
