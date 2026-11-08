import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { monthSurface } from './CalendarMonthBoard'

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
