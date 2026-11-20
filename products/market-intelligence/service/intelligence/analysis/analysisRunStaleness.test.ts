import { describe, expect, it } from 'vitest'

import { analysisRunStallPolicy, isStalledAnalysisRun } from './analysisRunStaleness'

const now = '2026-11-17T06:08:00.000Z'

describe('卡住的运行', () => {
  it('treats a running run past the stall window as stalled', () => {
    // 线上那次：22:07 排上，早上 06:08 还是 running，八小时没有任何终态。
    expect(isStalledAnalysisRun({ status: 'running', queuedAt: now, startedAt: '2026-11-16T22:07:17.000Z' }, now)).toBe(true)
  })

  it('keeps a fresh run in flight — the sweep must not kill work that is actually moving', () => {
    const startedAt = new Date(Date.parse(now) - 60_000).toISOString()
    expect(isStalledAnalysisRun({ status: 'running', queuedAt: startedAt, startedAt }, now)).toBe(false)
    // 排队也一样：作业可能还没轮到它。
    expect(isStalledAnalysisRun({ status: 'queued', queuedAt: startedAt, startedAt: null }, now)).toBe(false)
  })

  it('counts the queue wait from the queueing time, and leaves finished runs alone', () => {
    const longAgo = new Date(Date.parse(now) - analysisRunStallPolicy.stalledAfterMs - 1_000).toISOString()
    expect(isStalledAnalysisRun({ status: 'queued', queuedAt: longAgo, startedAt: null }, now)).toBe(true)
    for (const status of ['succeeded', 'failed', 'invalid-output', 'cancelled', 'stale', 'superseded'] as const) {
      expect(isStalledAnalysisRun({ status, queuedAt: longAgo, startedAt: longAgo }, now)).toBe(false)
    }
  })

  it('stays above the enclosing job budget', () => {
    // 作业预算是 10 分钟；清点阈值必须更大，否则正常的长运行会被当陈尸收掉。
    expect(analysisRunStallPolicy.stalledAfterMs).toBeGreaterThan(10 * 60_000)
  })
})
