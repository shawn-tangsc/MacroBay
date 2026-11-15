import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 国家列的**宽度地板**与**出现位置**。
 *
 * 两条都是 ratchet：happy-dom 不算布局，`scrollWidth`/`clientWidth` 恒为 0，真正的截断只能在
 * 浏览器引擎里量。地板数字是量出来的（2026-11-16，无头 Chrome，应用那条字体栈
 * `Inter, ui-sans-serif, system-ui, …`，字号 11px，容器宽 250px）：
 *
 * | 文案 | scrollWidth | 44px 列 | 52px 列 |
 * |---|---|---|---|
 * | 未知国家 | 46 | 截断（46/44） | **放得下（52/52）** |
 * | `Unknown` | 51 | 截断（51/44） | **放得下（52/52）** |
 *
 * 所以地板是 52：再窄就会把「不知道是哪国」画成「未知…」，而这一格是这条信息唯一的位置。
 */
const css = readFileSync(new URL('./economicCalendar.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('the country column', () => {
  it('is wide enough for the longest label it has to show', () => {
    const width = Number(/--mi-calendar-country-width:\s*(\d+)px/u.exec(css)?.[1])
    expect(width).toBeGreaterThanOrEqual(52)
  })

  it('only exists where a day list reads events, never inside a month cell', () => {
    // 「月历格不显示国家」不是靠一条 `display: none` 实现的，而是**月历格根本不渲染这个行组件**：
    // 唯一的渲染点是当日事件列表。谁把它接进月格，这条会红（那时国家列会立刻吃掉标题宽度）。
    const dir = new URL('.', import.meta.url).pathname
    const importers = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
      .filter((name) => /from '\.\/CalendarEventRow'|from "\.\/CalendarEventRow"/u.test(readFileSync(join(dir, name), 'utf8')))
    expect(importers).toEqual(['CalendarDayEventList.tsx'])
  })
})
