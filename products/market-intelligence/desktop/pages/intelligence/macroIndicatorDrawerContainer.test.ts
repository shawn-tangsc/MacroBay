import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉里两列的收放**按容器宽度判断，不按窗口宽度**。
 *
 * 为什么必须有这一条：抽屉是 `full` 档（1280、上限 94vw），它自己的宽度由档位和窗口共同决定，
 * 所以「窗口有多宽」回答不了「抽屉里还剩多少」。2026-11-12 设计给的判据就是按容器——
 * 「右侧「当日事件」在容器窄于 1024 时堆到下面」，并点名「不能用窗口 `@media`，
 * 否则抽屉里判断的是整窗宽度、永远不触发」。
 *
 * 之前的两处判断都写在 `economicCalendar.css` 的窗口 `@media` 里，而它们指向的两个选择器
 * （`.mi-economic-calendar`、`.mi-economic-calendar__workspace`）随旧日历页一起没了：
 * 于是窗口 1024 时抽屉里那列当日事件被剥掉左边框、由两列并排原样挤着（那列只剩约 180px），
 * 窗口 1024–1279 之间更是完全没人管。
 *
 * **它是 ratchet，不是行为红证**：`vitest` 不处理 CSS，`getComputedStyle` 在 happy-dom 里
 * 拿不到样式表里的值，写「断言列宽小于 X」只会是假绿。行为证据要无头 Chrome 加载两份真样式表量
 * 计算值，那一步归界面设计在真机上看（本轮改动已报给 Chief 转界面设计）。
 */
const drawerCss = readFileSync(new URL('./macroIndicatorDrawer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const calendarCss = readFileSync(new URL('../../features/macro/economic-calendar/economicCalendar.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const rules = (css: string): readonly Readonly<{ selector: string; body: string }>[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }))

/** 取一个 at-rule 的块内容：`@container` 里还套着规则，不能用单层正则切。 */
const blockAt = (css: string, at: string): string | undefined => {
  const start = css.indexOf(at)
  if (start < 0) return undefined
  const open = css.indexOf('{', start)
  if (open < 0) return undefined
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  return undefined
}

/** 左侧读数列的固定宽度（设计锁的 828）、列间距、右侧当日事件列的最小可用宽度（同 320 档）。 */
const READING_COLUMN = 828
const COLUMN_GAP = 16
const DAY_PANEL_MIN = 320
/** `full` 档 1280 减去正文左右各 16 的内距。 */
const DEFAULT_CONTENT_WIDTH = 1280 - 32

describe('the drawer judges its columns by its own width', () => {
  it('declares the drawer body as the query container', () => {
    const body = rules(drawerCss).find((rule) => rule.selector === '.mk-drawer .ant-drawer-body')
    expect(body?.body).toContain('container-type: inline-size')
    expect(body?.body).toContain('container-name: mk-drawer')
  })

  it('keeps the locked two-column layout as the base', () => {
    const section = rules(drawerCss).find((rule) => rule.selector === '.mk-sec')
    expect(section?.body).toContain(`grid-template-columns: ${READING_COLUMN}px minmax(0, 1fr)`)
  })

  it('stacks below the width where the day column stops being usable', () => {
    const condition = /@container\s+mk-drawer\s*\(max-width:\s*(\d+)px\)/u.exec(drawerCss)
    expect(condition).not.toBeNull()
    const threshold = Number(condition![1])
    // 早于「右侧只剩不到 320」就要收成一列；晚于这个数，那一列已经被挤成一条缝。
    expect(threshold).toBeLessThan(READING_COLUMN + COLUMN_GAP + DAY_PANEL_MIN)
    // 但 `full` 档自己的宽度下不能收：那会让读者在宽屏上也看到一列。
    expect(threshold).toBeLessThan(DEFAULT_CONTENT_WIDTH)

    const block = blockAt(drawerCss, `@container mk-drawer (max-width: ${threshold}px)`)
    expect(block).toBeDefined()
    expect(block).toContain('grid-template-columns: minmax(0, 1fr)')
    // 收成一列后，右侧那列改由上方一条分隔线承担。
    expect(block).toContain('.mk-col-r')
    expect(block).toContain('border-top')
  })

  it('keeps the day list from drawing a second border and a second gutter inside the column', () => {
    // 右列自己那条线就是分隔线。当日列表在日历页里自带 `padding-left: 22 + border-left: 1`
    // （`economicCalendar.css`），两层叠在一起：320 的轨道给行内容只剩 280，两列模式下还多一条同色竖线。
    // 所以「撤掉内层」是**基础规则**，不是收成一列时才撤——两种模式都要只有一条线。
    const inner = rules(drawerCss).find((rule) => rule.selector === '.mk-col-r .mi-calendar-day-list')
    expect(inner?.body).toContain('padding-left: 0')
    expect(inner?.body).toContain('border-left: 0')
    // 反向：不许在 `@container` 里再撤一次（那样两列模式下仍是两层）。
    const condition = /@container\s+mk-drawer\s*\(max-width:\s*(\d+)px\)/u.exec(drawerCss)!
    expect(blockAt(drawerCss, `@container mk-drawer (max-width: ${condition[1]}px)`))
      .not.toContain('.mi-calendar-day-list')
  })

  it('never asks the window for a drawer width', () => {
    // 抽屉的宽度由档位决定，不由窗口决定：这里任何一条窗口 `@media` 都在判断错的对象。
    expect(drawerCss).not.toContain('@media')
  })

  it('leaves no window-width rule for the day list behind in the calendar stylesheet', () => {
    const media = [...calendarCss.matchAll(/@media[^{]*/gu)]
      .map((match) => blockAt(calendarCss, match[0]))
      .filter((block): block is string => block !== undefined)
    const leftover = media.filter((block) => /mi-calendar-day-list|mi-economic-calendar__workspace|\.mi-economic-calendar\s*\{/u.test(block))
    expect(leftover).toEqual([])
  })
})
