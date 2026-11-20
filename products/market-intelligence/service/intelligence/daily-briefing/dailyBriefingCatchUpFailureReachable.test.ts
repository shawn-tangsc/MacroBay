import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readCalendarFreshnessFromJobRuns, readStandardTableLastWrittenAt } from '../macro-calendar/marketCalendarFreshnessFromJobs'
import { briefingMacroEmptyReason } from './dailyBriefingMacroEmptyReason'

/**
 * **「最近一次采集失败」这句话必须真的能出现**（2026-11-16）。
 *
 * 它曾经不可达：判定读取器有了 `latestAttempt` 这个展示输入，但装配处没喂——能力在、喂的人不在，
 * 不报错、只会静默地永远不显示。这条用例把「喂进去之后那句话真的出来」钉住。
 *
 * 构造：标准表最后一次写入是 3 天前（判过期），attempts 里同一路最近一次尝试是**失败**、
 * 且晚于那次写入 → 判定必须是 `calendar-collect-failed`，不是「过期」。
 */
describe('失败提示的可达性', () => {
  it('写入在 3 天前、最近一次尝试失败且更晚 → 出「最近一次采集失败」', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`create table mi_calendar_events (observed_at text not null)`)
    database.prepare('insert into mi_calendar_events(observed_at) values (?)').run('2026-11-13T10:00:00.000Z')
    const freshness = readCalendarFreshnessFromJobRuns({
      lastWrittenAt: readStandardTableLastWrittenAt(database),
      asOf: '2026-11-16T09:30:00.000Z',
      // 装配处现在会喂这份展示输入（`readLatestAttempts`）。
      latestAttempts: [{ descriptorId: 'macro-calendar-0xrouter-economic-data',
        latestAttempt: { attemptedAt: '2026-11-16T09:00:00.000Z', state: 'failed' } }]
    })
    expect(freshness.lastCollectedAt).toBe('2026-11-13T10:00:00.000Z')
    // 文档那条链取「跨来源最近一次尝试」喂给判定（`latestAttempt` 就是为它准备的）。
    const attempts = freshness.sources
      .flatMap((source) => (source.latestAttempt === undefined ? [] : [source.latestAttempt]))
      .sort((left, right) => (left.attemptedAt < right.attemptedAt ? 1 : -1))
    expect(attempts.length).toBe(1)
    expect(briefingMacroEmptyReason({
      state: 'available',
      ...(freshness.lastCollectedAt === null ? {} : { lastCollectedAt: freshness.lastCollectedAt }),
      lastAttemptAt: attempts[0]!.attemptedAt,
      lastAttemptFailed: attempts[0]!.state === 'failed',
      dataAsOf: '2026-11-16T09:30:00.000Z'
    })).toBe('calendar-collect-failed')
  })
})
