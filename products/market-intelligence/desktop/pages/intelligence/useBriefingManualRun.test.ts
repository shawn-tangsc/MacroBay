// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { useBriefingManualRun } from './useBriefingManualRun'

const now = new Date('2026-11-05T09:00:00.000Z')

const run = (cutoff: string, windowHours = 24) => {
  const regenerate = vi.fn(async () => undefined)
  const start = useBriefingManualRun({ timeZone: 'UTC', regenerate, now: () => now })
  const outcome = start({ cutoff, windowHours: windowHours as 24, language: 'zh-CN' })
  return { outcome, regenerate }
}

describe('a manual run refuses a cutoff that has not happened yet', () => {
  it('starts when the chosen hour is in the past', () => {
    const { outcome, regenerate } = run('08:00')
    expect(outcome).toEqual({ outcome: 'started' })
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('refuses a later hour today, and does not write anything', () => {
    // 未来时刻等于"生成一份还没发生的窗口"：那一刻没有数据，跑出来的是一份空报告。
    const { outcome, regenerate } = run('23:30')
    expect(outcome).toEqual({ outcome: 'cutoff-in-future' })
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('keeps 「现在」 usable: it is the press itself, never later than now', () => {
    const { outcome, regenerate } = run('now')
    expect(outcome).toEqual({ outcome: 'started' })
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('refuses to start a second run while one is in flight, and says so', () => {
    // 读者连按两次不是"两次意图"，是"第一次没反应"——起跑前就说清楚，而不是默默排队。
    const regenerate = vi.fn(async () => undefined)
    const start = useBriefingManualRun({ timeZone: 'UTC', regenerate, now: () => now, running: true })
    expect(start({ cutoff: 'now', windowHours: 24, language: 'zh-CN' })).toEqual({ outcome: 'already-running' })
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('hands back the edition it would overwrite instead of writing a duplicate', () => {
    // A7.10：同一 (日期, 截止, 窗口, 语言) 只许一版。撞上时不是再插一行，而是把那一版交给页面去问。
    const regenerate = vi.fn(async () => undefined)
    const start = useBriefingManualRun({
      timeZone: 'UTC', regenerate, now: () => now,
      findDuplicate: () => ({ periodId: 'period_manual_1' })
    })
    const result = start({ cutoff: 'now', windowHours: 24, language: 'zh-CN' })
    expect(result.outcome).toBe('duplicate')
    expect(result.duplicate?.periodId).toBe('period_manual_1')
    expect(regenerate).not.toHaveBeenCalled()
  })
})
