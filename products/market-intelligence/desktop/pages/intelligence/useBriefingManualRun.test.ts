// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { useBriefingManualRun } from './useBriefingManualRun'

const now = new Date('2026-11-05T09:00:00.000Z')

const run = (cutoff: string, windowHours = 24, date = '2026-11-05') => {
  const regenerate = vi.fn(async () => undefined)
  const start = useBriefingManualRun({ timeZone: 'UTC', regenerate, now: () => now })
  const outcome = start({ date, cutoff, windowHours: windowHours as 24, language: 'zh-CN' })
  return { outcome, regenerate }
}

describe('a manual run refuses a cutoff that has not happened yet', () => {
  it('starts when the chosen hour is in the past', () => {
    const { outcome, regenerate } = run('08:00')
    expect(outcome).toEqual({ outcome: 'started' })
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  // 读者选了「8 点 + 英文」，请求里必须带这三样；少任何一样，跑出来的就不是他要的那一期。
  it('sends the chosen hour, the chosen language and a one-off period id', () => {
    const regenerate = vi.fn(async (_input: {
      periodId: string
      locale: string
      generation: { asOf: string; windowHours: number }
    }) => undefined)
    const start = useBriefingManualRun({ timeZone: 'UTC', regenerate, now: () => now })
    start({ date: '2026-11-05', cutoff: '08:00', windowHours: 24, language: 'en-US' })

    const request = regenerate.mock.calls[0]![0]
    expect(request.locale).toBe('en-US')
    expect(request.generation).toEqual({ asOf: '2026-11-05T08:00:00.000Z', windowHours: 24 })
    // 一次性期号：不是 `default`，也不是刚才那一版的期号。
    expect(request.periodId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
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
    expect(start({ date: '2026-11-05', cutoff: 'now', windowHours: 24, language: 'zh-CN' })).toEqual({ outcome: 'already-running' })
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('hands back the edition it would overwrite instead of writing a duplicate', () => {
    // A7.10：同一 (日期, 截止, 窗口, 语言) 只许一版。撞上时不是再插一行，而是把那一版交给页面去问。
    const regenerate = vi.fn(async () => undefined)
    const start = useBriefingManualRun({
      timeZone: 'UTC', regenerate, now: () => now,
      findDuplicate: () => ({ periodId: 'period_manual_1' })
    })
    const result = start({ date: '2026-11-05', cutoff: 'now', windowHours: 24, language: 'zh-CN' })
    expect(result.outcome).toBe('duplicate')
    expect(result.duplicate?.periodId).toBe('period_manual_1')
    expect(regenerate).not.toHaveBeenCalled()
  })
})

// `02` v2.129 G1：选中的日期才是 00:00 那一天。机器本地日期（11/06）不再参与换算，
// 否则凌晨选 00:00 会把整版归档到第二天——用户实测踩到的正是这一条。
describe('a manual run uses the day the reader picked', () => {
  const machineNow = new Date('2026-11-06T17:20:00.000Z') // 11/07 01:20 于 Asia/Shanghai
  const start = (date: string, cutoff: string) => {
    const regenerate = vi.fn(async (_input: { periodId: string; locale: string; date?: string; generation: { asOf: string; windowHours: number } }) => undefined)
    const begin = useBriefingManualRun({ timeZone: 'Asia/Shanghai', regenerate, now: () => machineNow })
    return { outcome: begin({ date, cutoff, windowHours: 24, language: 'zh-CN' }), regenerate }
  }

  it('lands 00:00 on the picked day, not on the machine’s calendar day', () => {
    const { regenerate } = start('2026-11-05', '00:00')
    expect(regenerate.mock.calls[0]![0].generation.asOf).toBe('2026-11-04T16:00:00.000Z')
  })

  it('carries the picked day with the request, so the running row sits on that day', () => {
    const { regenerate } = start('2026-11-05', '07:00')
    expect(regenerate.mock.calls[0]![0].date).toBe('2026-11-05')
  })

  it('refuses a future day outright, because that edition has not happened yet', () => {
    // 未来一天等于凭空造一期：那一刻没有数据，跑出来是一份假装完整的空报告。
    const { outcome, regenerate } = start('2026-11-08', '00:00')
    expect(outcome).toEqual({ outcome: 'cutoff-in-future' })
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('refuses a date it cannot read instead of guessing today', () => {
    const { outcome, regenerate } = start('not-a-date', '00:00')
    expect(outcome).toEqual({ outcome: 'cutoff-unreadable' })
    expect(regenerate).not.toHaveBeenCalled()
  })
})
