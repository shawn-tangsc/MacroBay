import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 国家那一格在**抽屉右列真的显示**——这条判据是补一个漏：`72d40dd` 加固定国家列时，
 * `macroIndicatorDrawer.css` 里有一条 2026-11-13 为窄列写的
 * `.mk-col-r … .mi-economic-calendar__event-country { display: none }`，
 * 于是界面上一行国家都没有，而所有断言都跑在不带 `.mk-col-r` 的独立渲染里、全绿。
 *
 * **它是 ratchet，不是行为红证**：`vitest` 不处理 CSS（`css` 选项没开），
 * `getComputedStyle` 在 happy-dom 里拿不到样式表的值，写「断言 display 不是 none」只会是假绿。
 * 行为证据是文件头这段实测（无头 Chrome，加载这两份真样式表，`.mk-col-r` 里放一行）：
 *
 *   改前：`display: none`、宽度 **0**、文本取不到（整格不画）
 *   改后：`display: block`、宽度 **52**（`--mi-calendar-country-width`）、文本「美国」/`USA`/「未知国家」
 *
 * 所以这里断的是**样式表文本**：作用域选择器里对 `event-country` 写 `display: none` 即红。
 * 这次就是它：有人为窄列隐藏一格，六个月后另一条线再把它显出来，两边都以为自己是对的。
 */
const drawerCss = readFileSync(new URL('../../../pages/intelligence/macroIndicatorDrawer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const calendarCss = readFileSync(new URL('./economicCalendar.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const rules = (css: string): readonly Readonly<{ selector: string; body: string }>[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }))

describe('the country cell stays visible in the drawer column', () => {
  it('is never hidden by a scoped rule', () => {
    const hiding = [...rules(drawerCss), ...rules(calendarCss)]
      .filter((rule) => rule.selector.includes('event-country'))
      .filter((rule) => /display:\s*none/u.test(rule.body))
    expect(hiding).toEqual([])
  })

  it('keeps the three-column grid there, so the title does not fall into the country column', () => {
    // 反向：`.mk-col-r` 里也不许把这一行改回两列——那是「国家被藏起来」的另一半。
    const overrides = rules(drawerCss).filter((rule) => rule.selector.includes('.mk-col-r') && rule.body.includes('grid-template-columns'))
    expect(overrides).toEqual([])
    // 基础规则仍必须是三列（时间 | 国家 | 标题）。
    const base = rules(calendarCss).find((rule) => rule.selector === '.mi-economic-calendar__event')
    expect(base?.body).toContain('var(--mi-calendar-time-width) var(--mi-calendar-country-width) minmax(0, 1fr)')
  })
})
