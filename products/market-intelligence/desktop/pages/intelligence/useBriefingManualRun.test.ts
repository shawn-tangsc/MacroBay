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
    expect(outcome).toBe('started')
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('refuses a later hour today, and does not write anything', () => {
    // 未来时刻等于"生成一份还没发生的窗口"：那一刻没有数据，跑出来的是一份空报告。
    const { outcome, regenerate } = run('23:30')
    expect(outcome).toBe('cutoff-in-future')
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('keeps 「现在」 usable: it is the press itself, never later than now', () => {
    const { outcome, regenerate } = run('now')
    expect(outcome).toBe('started')
    expect(regenerate).toHaveBeenCalledTimes(1)
  })
})
