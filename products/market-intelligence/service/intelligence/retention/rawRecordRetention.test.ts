import { afterEach, describe, expect, it, vi } from 'vitest'

import { barRetentionCutoffs } from './barRetention'
import { createRawRecordRetentionTarget, logRawRecordRetention, rawRecordRetentionPolicy } from './rawRecordRetention'

const atMs = Date.UTC(2026, 10, 21, 4, 0, 0)

/** 真库 2026-11-21 那次盘点的形状：0 条记录过期、48 个孤儿待回收。 */
function pruneResult(overrides: Partial<{ removedRecords: number; removedPayloadFiles: number; removedOrphanFiles: number; reclaimedPayloadBytes: number; remainingRecords: number }> = {}) {
  return {
    cutoff: new Date(atMs - rawRecordRetentionPolicy.retentionDays * 24 * 3_600_000).toISOString(),
    removedRecords: 0,
    removedPayloadFiles: 0,
    removedOrphanFiles: 48,
    reclaimedPayloadBytes: 251_658,
    remainingRecords: 740,
    ...overrides
  }
}

describe('the raw record retention target', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('轮转边界是同一颗钟减保留期，孤儿原文一次跑就清', () => {
    const prune = vi.fn(() => pruneResult())
    const target = createRawRecordRetentionTarget({ pruneRawRecords: prune })

    const result = target.retention({ atMs, cutoffs: barRetentionCutoffs(atMs) })

    // 时钟来自那一跑，不是自己读一次：一次清理必须只有一个「今晚」。
    expect(prune).toHaveBeenCalledWith({
      retentionDays: 7,
      now: new Date(atMs).toISOString(),
      includeOrphans: true
    })
    // 没有记录过期也要有一次删除——孤儿等不到 7 天轮转。
    expect(result.deleted).toBe(0)
    expect(result.thinned).toBe(0)
  })

  it('报可对账的一组数：删几条、几个原文、几个孤儿、释放多少字节、还剩几条', () => {
    const report = vi.fn()
    const target = createRawRecordRetentionTarget({ pruneRawRecords: () => pruneResult({ removedRecords: 3, removedPayloadFiles: 2 }) }, report)

    const result = target.retention({ atMs, cutoffs: barRetentionCutoffs(atMs) })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0]).toEqual({
      atMs,
      cutoff: new Date(atMs - 7 * 24 * 3_600_000).toISOString(),
      removedRecords: 3,
      removedPayloadFiles: 2,
      removedOrphanFiles: 48,
      reclaimedPayloadBytes: 251_658,
      remainingRecords: 740
    })
    // job 的台账只有一格「删了多少条」；原文与字节数由那行 marker 带走，不能丢。
    expect(result).toEqual({ thinned: 0, deleted: 3, oldestKeptAtMs: null })
  })

  it('两串时间各有各的起点，所以不编一个「最早还剩哪条」', () => {
    const target = createRawRecordRetentionTarget({ pruneRawRecords: () => pruneResult() })
    // 通用记录按保留期轮转，日历记录的原文在自己那份证据配额里：压成一个最早就成了读不出主语的台账。
    expect(target.retention({ atMs, cutoffs: barRetentionCutoffs(atMs) }).oldestKeptAtMs).toBeNull()
  })

  it('marker 是一行 JSON，带数不带正文', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    logRawRecordRetention({ ...pruneResult({ removedRecords: 1 }), atMs })

    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line.startsWith('{"marker":"RAW_RECORD_RETENTION"')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      marker: 'RAW_RECORD_RETENTION',
      atMs,
      cutoff: expect.any(String),
      removedRecords: 1,
      removedPayloadFiles: 0,
      removedOrphanFiles: 48,
      reclaimedPayloadBytes: 251_658,
      remainingRecords: 740
    })
    // 不打印文件内容、不打印记录体：一行够排障即可。
    expect(line).not.toContain('payloadBody')
  })
})