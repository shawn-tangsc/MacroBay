import { describe, expect, it } from 'vitest'

import { briefingMacroEmptyReason } from './dailyBriefingMacroEmptyReason'

const dataAsOf = '2026-11-05T07:00:00.000Z'
const base = { state: 'available' as const, dataAsOf }

describe('the macro column says which kind of "we cannot see it" this is', () => {
  it('never collected', () => {
    expect(briefingMacroEmptyReason(base)).toBe('calendar-not-collected')
  })

  // 口径更新（用户 2026-11-16）：失败只有在**读数本身不可信**时才算数。读到数据且新鲜，
  // 窗口空就是空，别的源失败不改变它。
  it('a failure counts only when the reading itself is stale', () => {
    expect(briefingMacroEmptyReason({
      ...base,
      lastCollectedAt: '2026-11-03T13:27:00.000Z',
      lastAttemptAt: '2026-11-05T06:45:00.000Z',
      lastAttemptFailed: true
    })).toBe('calendar-collect-failed')
    expect(briefingMacroEmptyReason({
      ...base,
      lastCollectedAt: '2026-11-05T06:30:00.000Z',
      lastAttemptAt: '2026-11-05T06:45:00.000Z',
      lastAttemptFailed: true
    })).toBe('past-24h-no-high-impact-release')
  })

  // `#32`（用户 2026-11-19）：采到了、但写不进库，既不是「没采到」也不是「过期」——它有自己的句子，
  // 建议也不许指向网络。判据比时刻：失败晚于最后一次成功写入才算数。
  it('says the write failed when the write failure is newer than the last success', () => {
    const writeFailure = { at: '2026-11-05T06:45:00.000Z', code: 'standard-write-failed' }
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z', writeFailure }))
      .toBe('calendar-write-failed')
    // 码是两个值，句子同一句：对读者这两处的动作一样（查写入），不分成两套措辞。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z', writeFailure: { ...writeFailure, code: 'value-shape-rejected' } }))
      .toBe('calendar-write-failed')
  })

  it('keeps the old verdict for an old, unknown-code, or irrelevant write failure', () => {
    // 三重 fail-safe：失败早于最后一次成功 → 后来写成功了，按原逻辑；
    expect(briefingMacroEmptyReason({
      ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z',
      writeFailure: { at: '2026-11-02T00:00:00.000Z', code: 'standard-write-failed' }
    })).toBe('calendar-stale')
    // 码不在闭集（契约会整份作废，这里是函数自身的兜底）→ 原逻辑；
    expect(briefingMacroEmptyReason({
      ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z',
      writeFailure: { at: '2026-11-05T06:45:00.000Z', code: 'something-else' as never }
    })).toBe('calendar-stale')
    // 数据本身还新鲜：窗口空就是空，写入失败不改变这一句（用户 2026-11-16 的口径仍成立）。
    expect(briefingMacroEmptyReason({
      ...base, lastCollectedAt: '2026-11-05T06:50:00.000Z',
      writeFailure: { at: '2026-11-05T06:55:00.000Z', code: 'standard-write-failed' }
    })).toBe('past-24h-no-high-impact-release')
    // 没有任何写失败字段：完全等于改动前。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z' })).toBe('calendar-stale')
  })

  it('a later success outranks an earlier failure', () => {
    // "失败后又有成功"不许判成失败：比较两次时刻的先后，不是只看最近一次的状态。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-05T06:50:00.000Z', lastAttemptAt: '2026-11-05T06:30:00.000Z', lastAttemptFailed: true }))
      .toBe('past-24h-no-high-impact-release')
  })

  it('stale when the last success is more than two hours before the data cutoff', () => {
    // 11-05 那期：截止 07:00，最后一次成功在前天 21:27 —— 过期，必须写"读不到"，不许写"没有"。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z' })).toBe('calendar-stale')
  })

  it('fresh data with nothing in the window is the only "there was nothing"', () => {
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-05T06:30:00.000Z' })).toBe('past-24h-no-high-impact-release')
  })

  // 用户 2026-11-16：读到数据、读数新鲜时，窗口空就是空——**任何一路的失败都改不了这个事实**。
  // 旧判定把「跨所有源最近一次尝试失败」放在最前，于是别的源（BLS 被拦）一失败，这一栏就
  // 写成「最近一次日历采集失败」，还把读者引去改配置。
  it('lets "nothing in a fresh window" win over another feed\'s failure', () => {
    expect(briefingMacroEmptyReason({
      ...base,
      lastCollectedAt: '2026-11-05T06:30:00.000Z',
      lastAttemptAt: '2026-11-05T06:45:00.000Z',
      lastAttemptFailed: true
    })).toBe('past-24h-no-high-impact-release')
  })

  it('a failed read is "cannot see", never "nothing there"', () => {
    expect(briefingMacroEmptyReason({ ...base, state: 'unavailable' })).toBe('calendar-unavailable')
    expect(briefingMacroEmptyReason({ ...base, state: 'source-disabled' })).toBe('calendar-source-disabled')
  })
})
