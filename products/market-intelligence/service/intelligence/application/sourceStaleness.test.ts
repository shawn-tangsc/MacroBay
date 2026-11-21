import { describe, expect, it } from 'vitest'

import { buildPipelineHealthSnapshot } from './pipelineHealth'
import {
  evaluateSourceStaleness,
  mergeNormalizeStreak,
  normalizeStreakFromCheckpoint,
  normalizeStreakUpdate,
  preserveNormalizeStreak,
  stalenessThresholdMs
} from './sourceStaleness'

/* 2026-11-21 事故：采集日志全绿、新闻两天没产出。判据必须盯产出，且「没产出」与
   「有产出但归一化一直失败」是两种病，各自成条，不许合并。 */

const NOW = Date.parse('2026-11-21T12:00:00.000Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * 60 * 60 * 1_000).toISOString()

describe('source staleness thresholds', () => {
  it('每个源用自己的 p99：coinDesk 24h 下限、币安 48h 上限、未知源按上限', () => {
    // coinDesk p99=11.05h → 2×p99=22.1h，取下限 24h。
    expect(stalenessThresholdMs('coindesk-rss')).toBe(24 * 60 * 60 * 1_000)
    // 币安正常能静默 35.67h → 2×p99=71.34h，取上限 48h；压到 24h 会误报。
    expect(stalenessThresholdMs('binance-announcements')).toBe(48 * 60 * 60 * 1_000)
    // 没有分布数据的源不假装知道，按上限报。
    expect(stalenessThresholdMs('unmeasured-source')).toBe(48 * 60 * 60 * 1_000)
  })
})

describe('evaluateSourceStaleness', () => {
  it('coindesk 30 小时没有新内容 → no-output', () => {
    expect(
      evaluateSourceStaleness(
        { sourceId: 'coindesk-rss', lastOutputAt: hoursAgo(30), normalize: { streak: 0 } },
        NOW
      )
    ).toEqual(['no-output'])
  })

  it('币安 30 小时没产出不报：它的正常间隔上限就是 48 小时', () => {
    expect(
      evaluateSourceStaleness(
        { sourceId: 'binance-announcements', lastOutputAt: hoursAgo(30), normalize: { streak: 0 } },
        NOW
      )
    ).toEqual([])
  })

  it('defillama 连续 3 次失败且首败 3 小时前 → normalize-failing（有产出也算另一种病）', () => {
    expect(
      evaluateSourceStaleness(
        {
          sourceId: 'defillama-tvl',
          lastOutputAt: hoursAgo(0.1),
          normalize: { streak: 3, firstFailureAt: hoursAgo(3) }
        },
        NOW
      )
    ).toEqual(['normalize-failing'])
  })

  it('两种病同时为真时两条都报，不挑一个', () => {
    expect(
      evaluateSourceStaleness(
        {
          sourceId: 'coindesk-rss',
          lastOutputAt: hoursAgo(30),
          normalize: { streak: 3, firstFailureAt: hoursAgo(3) }
        },
        NOW
      )
    ).toEqual(['no-output', 'normalize-failing'])
  })

  it('缺 lastOutputAt 不判 no-output：「不知道」不等于「没产出」', () => {
    expect(evaluateSourceStaleness({ sourceId: 'coindesk-rss', normalize: { streak: 0 } }, NOW)).toEqual([])
  })

  it('连续 2 次或首败不足 2 小时都不报：单次抖动不算持续失败', () => {
    expect(
      evaluateSourceStaleness(
        { sourceId: 'defillama-tvl', normalize: { streak: 2, firstFailureAt: hoursAgo(3) } },
        NOW
      )
    ).toEqual([])
    expect(
      evaluateSourceStaleness(
        { sourceId: 'defillama-tvl', normalize: { streak: 3, firstFailureAt: hoursAgo(1) } },
        NOW
      )
    ).toEqual([])
  })
})

describe('normalize failure streak', () => {
  it('首次失败记时间，后续失败沿用首次时间，成功清零', () => {
    const first = normalizeStreakUpdate({
      checkpoint: undefined,
      failed: 1,
      processed: 0,
      nowIso: hoursAgo(3)
    })
    expect(first).toEqual({ normalizeFailureStreak: 1, firstNormalizeFailureAt: hoursAgo(3) })

    const second = normalizeStreakUpdate({
      checkpoint: { ...first },
      failed: 1,
      processed: 0,
      nowIso: hoursAgo(2)
    })
    expect(second).toEqual({ normalizeFailureStreak: 2, firstNormalizeFailureAt: hoursAgo(3) })

    const cleared = normalizeStreakUpdate({
      checkpoint: { ...second },
      failed: 0,
      processed: 5,
      nowIso: hoursAgo(1)
    })
    expect(cleared).toEqual({ normalizeFailureStreak: 0 })
  })

  it('合并清零时删掉首次失败时间，不留孤儿字段', () => {
    const merged = mergeNormalizeStreak(
      { lastPublishedAt: hoursAgo(1), normalizeFailureStreak: 3, firstNormalizeFailureAt: hoursAgo(3) },
      { normalizeFailureStreak: 0 }
    )
    expect(merged).toEqual({ lastPublishedAt: hoursAgo(1), normalizeFailureStreak: 0 })
  })

  it('采集成功换 checkpoint 时保留失败计数，不被一次成功抹掉', () => {
    const preserved = preserveNormalizeStreak(
      { lastPublishedAt: hoursAgo(0.5), appended: 2 },
      { normalizeFailureStreak: 3, firstNormalizeFailureAt: hoursAgo(3), lastPublishedAt: hoursAgo(1) }
    )
    expect(preserved).toEqual({
      lastPublishedAt: hoursAgo(0.5),
      appended: 2,
      normalizeFailureStreak: 3,
      firstNormalizeFailureAt: hoursAgo(3)
    })
  })

  it('字段缺失或非法时按 0 读，不猜', () => {
    expect(normalizeStreakFromCheckpoint(undefined)).toEqual({ streak: 0 })
    expect(normalizeStreakFromCheckpoint({ normalizeFailureStreak: 'oops' })).toEqual({ streak: 0 })
  })
})

describe('pipeline health snapshot staleReasons', () => {
  const state = (checkpoint: Record<string, unknown>) => ({
    owner: 'product' as const,
    productId: 'market-intelligence',
    resourceId: 'coindesk-rss',
    status: 'idle' as const,
    checkpoint,
    consecutiveFailures: 0,
    updatedAt: hoursAgo(0.5)
  })

  const snapshot = (checkpoint: Record<string, unknown>) =>
    buildPipelineHealthSnapshot({
      sourceId: 'coindesk-rss',
      runtimeStateStore: { get: () => state(checkpoint) },
      definition: undefined,
      isRetired: () => false,
      nowMs: NOW
    })

  it('源年龄超阈值 → 健康快照带 no-output 和小时数', () => {
    const view = snapshot({ lastPublishedAt: hoursAgo(30) })
    expect(view?.staleReasons).toEqual(['no-output'])
    expect(view?.staleMeasurements).toEqual({ noOutputHours: 30 })
  })

  it('归一化连续失败 → 健康快照带 normalize-failing 和次数', () => {
    const view = snapshot({
      lastPublishedAt: hoursAgo(0.1),
      normalizeFailureStreak: 3,
      firstNormalizeFailureAt: hoursAgo(3)
    })
    expect(view?.staleReasons).toEqual(['normalize-failing'])
    expect(view?.staleMeasurements).toEqual({ normalizeFailureStreak: 3 })
  })

  it('没有 lastPublishedAt 时不出 no-output：读不到就是读不到', () => {
    expect(snapshot({})?.staleReasons).toBeUndefined()
  })
})
