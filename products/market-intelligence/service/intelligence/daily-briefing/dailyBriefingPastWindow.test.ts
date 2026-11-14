import { describe, expect, it } from 'vitest'

import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'
import { selectPastWindowReleases } from './dailyBriefingPastWindow'

const window = { start: '2026-11-13T12:00:00.000Z', end: '2026-11-14T12:20:00.000Z', timeZone: 'Asia/Shanghai' }

function event(overrides: Partial<DailyBriefingCalendarEvent> & Pick<DailyBriefingCalendarEvent, 'scheduledAt'>): DailyBriefingCalendarEvent {
  return Object.freeze({
    eventKey: overrides.eventKey ?? `k-${overrides.scheduledAt}-${overrides.title ?? ''}`,
    title: overrides.title ?? '某事件',
    lifecycleState: overrides.lifecycleState ?? 'scheduled',
    category: overrides.category ?? 'economic-indicator',
    surprise: overrides.surprise ?? { direction: 'consensus-unavailable' as const, reason: 'missing-actual' },
    ...overrides
  })
}

/** 2026-11-14 真实窗口：1 条核心 PPI、5 场央行讲话、1 条油井数，全部没有重要性。 */
function realWindow(): readonly DailyBriefingCalendarEvent[] {
  return [
    event({ title: '核心 PPI 月率', scheduledAt: '2026-11-13T13:30:00.000Z' }),
    event({ title: '央行讲话', scheduledAt: '2026-11-13T14:10:00.000Z', category: 'central-bank-activity' }),
    event({ title: '央行讲话', scheduledAt: '2026-11-13T14:40:00.000Z', category: 'central-bank-activity' }),
    event({ title: '央行讲话', scheduledAt: '2026-11-13T15:50:00.000Z', category: 'central-bank-activity' }),
    event({ title: '央行讲话', scheduledAt: '2026-11-13T17:00:00.000Z', category: 'central-bank-activity' }),
    event({ title: '石油钻井数', scheduledAt: '2026-11-13T18:00:00.000Z', category: 'financial-event' }),
    event({ title: '央行讲话', scheduledAt: '2026-11-14T00:00:00.000Z', category: 'central-bank-activity' })
  ]
}

describe('the past-24h window', () => {
  // 这一条是产品口径的验收样例：总数与构成说 7 条（1+5+1），明细最多 3 条。
  it('counts every release in the window, including the ones it will not show', () => {
    const selection = selectPastWindowReleases(realWindow(), window)
    expect(selection.counts).toEqual({ total: 7, indicators: 1, centralBank: 5, financial: 1 })
    expect(selection.shown.length).toBeLessThanOrEqual(3)
    expect(selection.hidden).toBe(selection.counts.total - selection.shown.length)
  })

  // 类型不限（2/1/1 配比已作废）：明细就是**最近的三条**，讲话照列——不让「今天有没有指标」
  // 决定「讲话列不列」。这条同时钉住顺序：从新到旧。
  it('takes the three newest releases regardless of type', () => {
    const selection = selectPastWindowReleases(realWindow(), window)
    expect(selection.shown.map((event) => event.title)).toEqual(['央行讲话', '石油钻井数', '央行讲话'])
    expect(selection.shown.map((event) => event.scheduledAt)).toEqual([
      '2026-11-14T00:00:00.000Z', '2026-11-13T18:00:00.000Z', '2026-11-13T17:00:00.000Z'
    ])
    expect(selection.hidden).toBe(4)
  })

  // 不看「有没有值」：这一栏按时间读，按值排会让同一份窗口在不同天列出不同内容。
  it('orders by time, not by whether a value exists', () => {
    const selection = selectPastWindowReleases([
      event({ title: '无值指标', scheduledAt: '2026-11-13T13:00:00.000Z' }),
      event({ title: '有值指标', scheduledAt: '2026-11-13T20:00:00.000Z', actual: '0.3' })
    ], window)
    expect(selection.shown.map((event) => event.title)).toEqual(['有值指标', '无值指标'])
  })

  // 同一份输入必须给出同一份明细：同一时刻按 `eventKey` 定序，不靠数组原序。
  it('breaks a same-instant tie by event key so the same input always lists the same three', () => {
    const at = '2026-11-13T13:30:00.000Z'
    const selection = selectPastWindowReleases([
      event({ eventKey: 'b', scheduledAt: at }), event({ eventKey: 'a', scheduledAt: at }),
      event({ eventKey: 'c', scheduledAt: at }), event({ eventKey: 'd', scheduledAt: '2026-11-13T12:30:00.000Z' })
    ], window)
    expect(selection.shown.map((event) => event.eventKey)).toEqual(['a', 'b', 'c'])
  })

  // 总数 < 明细条数是不可能发生的：hidden 永远非负，这条防止「共 0 条却列了 1 条」。
  it('never reports fewer total releases than it shows', () => {
    const selection = selectPastWindowReleases(realWindow(), window)
    expect(selection.hidden).toBeGreaterThanOrEqual(0)
    expect(selection.shown.length).toBeLessThanOrEqual(selection.counts.total)
  })

  it('ignores events outside the window', () => {
    const selection = selectPastWindowReleases([
      event({ title: '窗口外', scheduledAt: '2026-11-12T00:00:00.000Z' })
    ], window)
    expect(selection.counts.total).toBe(0)
    expect(selection.shown).toHaveLength(0)
  })
})
