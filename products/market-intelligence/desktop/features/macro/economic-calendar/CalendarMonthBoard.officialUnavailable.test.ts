import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CalendarMonthBoard, monthSurface } from './CalendarMonthBoard'
import { createEconomicCalendarProjection } from './economicCalendarModel'

const zh = productText['zh-CN'].pages.intelligence.portal.calendar
const en = productText['en-US'].pages.intelligence.portal.calendar

/**
 * 「没有」与「拿不到」必须分得开（Chief 2026-11-08，三种画法各一条）。
 * 判据一句话：只有「两个来源都读到了」才允许说「本月没有」。
 */
describe('a month the official source could not be read for', () => {
  it('draws the unavailable surface — not the empty one — when nothing else was read either', () => {
    // 整月空 + 官方腿不可用 → 错误态（拿不到），不是「本月没有」。
    expect(monthSurface({ officialUnavailable: true, officialCount: 0, marketCount: 0 })).toBe('official-unavailable')
  })

  it('keeps the market rows with a note instead of an empty surface when the market side has rows', () => {
    // 官方不可用 + 市场侧有行 → 列出来 + 说明行；**不许落进空态**。
    expect(monthSurface({ officialUnavailable: true, officialCount: 0, marketCount: 3 })).toBe('note')
  })

  it('still says「本月没有」when both sources were read and both are empty', () => {
    // 两个来源都读到了、都为空 → 空态。它现在是独立的一档（`empty`），不再借用 `board`。
    expect(monthSurface({ officialUnavailable: false, officialCount: 0, marketCount: 0 })).toBe('empty')
  })

  it('decides the surface in one fixed order, and never calls a failed read empty', () => {
    // 四行表（界面设计 2026-11-09）的唯一判据处。顺序固定：在读 → 全关 → 命名月读不到 → 官方月读不到
    // → 官方腿停用 → 来源无该语言 → 确实为空。市场侧只读命名月自己的结论，不读窗口级 `failure`。
    const base = { officialUnavailable: false, officialCount: 0, marketCount: 0 } as const
    const failed = { status: 'failed', reason: 'read-threw' } as const
    expect(monthSurface({ ...base, monthRead: 'loading' })).toBe('loading')
    expect(monthSurface({ ...base, marketLoading: true })).toBe('loading')
    expect(monthSurface({ ...base, officialFeeds: 'disabled' })).toBe('disabled')
    expect(monthSurface({ ...base, marketMonthRead: failed })).toBe('error')
    expect(monthSurface({ ...base, monthRead: 'unavailable' })).toBe('error')
    // 另一侧还有内容：列出已有行 + 说明行，绝不摆空态。
    expect(monthSurface({ ...base, marketCount: 2, marketMonthRead: failed })).toBe('note')
    expect(monthSurface({ ...base, officialCount: 1, monthRead: 'unavailable' })).toBe('note')
    // 来源不发布读者语言：说明行，不是「本月没有」。
    expect(monthSurface({ ...base, marketSources: [{ eventType: 'financial-event', status: 'no-locale-rows', sourceObservedAt: null }] }))
      .toBe('no-locale')
    // 都读到、确实为空：这才是空态。
    expect(monthSurface(base)).toBe('empty')
  })

  it('never calls a month it could not read "no calendar source is enabled"', () => {
    // 架构师 2026-11-09 审出：`feeds` 与 `events` 是两路异步。加载中 `events` 天然为空，先判全关会让
    // 这一屏闪一下；月查询失败时更糟——「读不到」会被说成「来源全关」。空态只该在读完且确实为空时出现。
    const board = (state: Parameters<typeof CalendarMonthBoard>[0]['state']) => renderToStaticMarkup(createElement(CalendarMonthBoard, {
      asOf: '2026-11-01T00:00:00.000Z', coverage: 'complete', events: [], marketEvents: [], marketSources: [],
      month: '2026-11', onOpenDay: () => undefined, onOpenSettings: () => undefined, onSelectItem: () => undefined, officialFeeds: 'disabled',
      selectedEventKey: undefined, state, statusNow: '2026-11-01T00:00:00.000Z', text: zh, today: '2026-11-01'
    }))

    // 读失败：说的是「拿不到」，不是「来源全关」。
    const failed = board({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    expect(failed).not.toContain(zh.status.noSourceEnabled)
    expect(failed).toContain(zh.failures['calendar-query-unavailable'])
    // 正在读：给的是加载态，不是判定。
    expect(board({ state: 'loading' })).not.toContain(zh.status.noSourceEnabled)
    // 读完且确实是空 —— 这才是「来源全关」该出现的时候（反向：抹掉那条 `available` 条件，这条会红）。
    const projection = createEconomicCalendarProjection({ asOf: '2026-11-01T00:00:00.000Z', events: [], month: '2026-11' })
    expect(board({ state: 'available', projection, events: [], incomplete: false, version: 1 }))
      .toContain(zh.status.noSourceEnabled)
  })

  it('hangs the note on role="note", not on a live region', () => {
    // 界面自查 2026-11-08：`role="status"` 是活区，读屏会把常驻注解念成「刚刚发生了变化」。
    const source = readFileSync('products/market-intelligence/desktop/features/macro/economic-calendar/CalendarMonthBoard.tsx', 'utf8')
    expect(source).toContain('role="note"')
    // 说明行不许再被塞进 `status`（那条路径渲染的是活区）。
    expect(source).not.toContain("status ??= officialUnavailable")
  })

  /**
   * 2026-11-11 更正：这句只在 **BLS** 的 HTML 日程被 403 挡住时出现，所以说的是「BLS 官方日程」而不是
   * 「官方源」——fed/bea 照常在画，写成复数会让读者以为全部官方数据都没了。日期是参数：那次真实同步
   * 的时刻（`lastSuccessfulSyncAt`），句子里**不许出现写死的日期**。
   */
  /**
   * 两句分工（用户 2026-11-10 的硬口径 + `check:body-prose`）：**正文只有状态词**，
   * 原因（403）、画的是哪次同步、怎么拿到新的，全部进那颗 ⓘ。日期从同步记录来，不写死。
   */
  it('keeps only a status word in the body, and the why plus the sync date in the ⓘ', () => {
    expect(zh.officialUnavailableShort).toBe('BLS 官方日程无法自动获取')
    expect(en.officialUnavailableShort).toBe('The BLS official schedule cannot be fetched')
    // 正文那句里不许出现任何解释词。
    for (const label of [zh.officialUnavailableShort, en.officialUnavailableShort]) {
      expect(label).not.toContain('403')
      expect(label).not.toContain('同步')
      expect(label).not.toMatch(/\d{4}-\d{2}-\d{2}/u)
    }
    // ⓘ 里才是完整说明：原因、那次同步的日期、怎么拿到新的。
    expect(zh.officialUnavailableNote).toContain('403')
    expect(zh.officialUnavailableNote).toContain('{date}')
    expect(zh.officialUnavailableNote).toContain('ICS')
    expect(en.officialUnavailableNote).toContain('403')
    expect(en.officialUnavailableNote).toContain('{date}')
    for (const sentence of [zh.officialUnavailableNote, en.officialUnavailableNote]) {
      // 「暂时」当时是错的：这条腿不是暂时不可用，是 403 挡住、自动同步已停。
      expect(sentence).not.toContain('暂时')
      // 不许写死任何日期。
      expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/u)
    }
  })
})
