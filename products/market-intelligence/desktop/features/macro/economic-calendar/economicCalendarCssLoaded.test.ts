import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：`economicCalendar.css` 必须被**至少一个生产文件 import**。
 *
 * 为什么会有这条（用户 2026-11-15 报的真 bug）：这份样式表原来由旧「经济日历」页 import，
 * 页面整页删掉之后**再没有任何生产文件加载它**——只有测试用 `readFileSync` 读源码。
 * 结果抽屉里那批行丢了样式，时刻与标题挤成一行（截图里 `21:30Empire State manufacturing survey`）。
 *
 * 判据刻意分成两半，缺一条都抓不住这个 bug：
 * 1. **import 计数 ≥ 1**：`readFileSync` 读文件不算加载，测试读它更不能当加载；
 * 2. **这条 import 仍在渲染那批行的目录里**：挂到别的页面等于没挂，行照样没样式。
 */
/* 本文件在 `products/market-intelligence/desktop/features/macro/economic-calendar/`：上四层是产品根。 */
const PRODUCT = new URL('../../../../', import.meta.url).pathname
const CSS = 'features/macro/economic-calendar/economicCalendar.css'
const FOLDER = join(PRODUCT, 'desktop/features/macro/economic-calendar')

function productionFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...productionFiles(full)); continue }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

/** `import './x.css'` / `import '../y/x.css'` —— 只认 import 语句，不认 `readFileSync` 里的字符串。 */
function importsStylesheet(source: string, target: string): boolean {
  const pattern = new RegExp(`import\\s+['"][^'"]*${target}['"]`)
  return pattern.test(source)
}

describe('the calendar stylesheet keeps a production load point', () => {
  it('is imported by at least one production file (reading it in a test does not count)', () => {
    const importers = productionFiles(join(PRODUCT, 'desktop'))
      .filter((file) => importsStylesheet(readFileSync(file, 'utf8'), 'economicCalendar.css'))
      .map((file) => relative(PRODUCT, file))
    expect(importers, `没有任何生产文件 import ${CSS}——行会丢样式（用户 2026-11-15 的截图）`).not.toEqual([])
  })

  it('is loaded from the folder that renders those rows, not from an unrelated page', () => {
    const importers = productionFiles(join(PRODUCT, 'desktop'))
      .filter((file) => importsStylesheet(readFileSync(file, 'utf8'), 'economicCalendar.css'))
    const inFolder = importers.filter((file) => file.startsWith(FOLDER))
    expect(inFolder.length, '这份样式表必须在渲染行的那几个文件里挂，挂到别处等于没挂').toBeGreaterThan(0)
  })

  it('still defines the classes the drawn rows carry', () => {
    // 加载点修好之后，还得确认样式表里真有行用的那几个类：类名被改名而样式没跟上，
    // 与「没有加载」在界面上是同一种表现（挤成一行），从 DOM 上看不出区别。
    const css = readFileSync(join(FOLDER, 'economicCalendar.css'), 'utf8')
    for (const className of ['mi-economic-calendar__event-time', 'mi-economic-calendar__event-title', 'mi-calendar-day-list__head']) {
      expect(css, className).toContain(`.${className}`)
    }
  })
})
