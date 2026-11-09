import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CalendarMonthBoard, monthStatusLines, monthSurface } from './CalendarMonthBoard'
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
    // 两个来源都读到了、都为空 → 既有空态，不动。
    expect(monthSurface({ officialUnavailable: false, officialCount: 0, marketCount: 0 })).toBe('board')
  })

  it('shows one line, not two, when the note and the unavailable status would say the same thing', () => {
    // 组合可达：BLS 停用 + 当月查询也失败 + 市场侧有行 → 注解与 `unavailable` 讲的是同一件事。
    const lines = monthStatusLines({ note: zh.officialUnavailableNote, state: 'unavailable', status: '经济日历暂时不可用。' })
    expect(lines.note).toBe(zh.officialUnavailableNote)
    expect(lines.status).toBeUndefined()
    // 「正在读」不是重复：那行必须留下。
    expect(monthStatusLines({ note: zh.officialUnavailableNote, state: 'loading', status: '正在加载经济日历…' }).status)
      .toBe('正在加载经济日历…')
    // 没有注解时，状态行照旧显示。
    expect(monthStatusLines({ state: 'unavailable', status: '经济日历暂时不可用。' }).status).toBe('经济日历暂时不可用。')
  })

  it('never calls a month it could not read "no calendar source is enabled"', () => {
    // 架构师 2026-11-09 审出：`feeds` 与 `events` 是两路异步。加载中 `events` 天然为空，先判全关会让
    // 这一屏闪一下；月查询失败时更糟——「读不到」会被说成「来源全关」。空态只该在读完且确实为空时出现。
    const board = (state: Parameters<typeof CalendarMonthBoard>[0]['state']) => renderToStaticMarkup(createElement(CalendarMonthBoard, {
      asOf: '2026-11-01T00:00:00.000Z', coverage: 'complete', events: [], marketEvents: [], marketSources: [],
      month: '2026-11', onOpenDay: () => undefined, onSelectItem: () => undefined, officialFeeds: 'disabled',
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

  it('uses the final sentence verbatim in both languages, "temporarily" included', () => {
    expect(zh.officialUnavailableNote).toBe('官方源暂时不可用，先显示上次成功同步的内容')
    expect(en.officialUnavailableNote).toBe('The official source is temporarily unavailable; showing the last successful sync')
    expect(en.officialUnavailableNote).toContain('temporarily')
  })
})
