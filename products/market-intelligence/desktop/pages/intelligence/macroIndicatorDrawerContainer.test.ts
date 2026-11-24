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
  /**
   * 容器锚点必须是**我们自己的类**（2026-11-24）。
   *
   * 以前挂的是 `.ant-drawer-body`——平台内部实现，改名就静默失效、用例还全绿。平台 `Drawer` 现在
   * 有 `bodyClassName`（`0766aa18d`），所以锚点归我们：`<Drawer bodyClassName="mk-drawer-body">`，
   * 容器查询挂在 `.mk-drawer .mk-drawer-body` 上，容器名不变（`mk-drawer`）。
   */
  it('declares the drawer body as the query container, on our own class', () => {
    const body = rules(drawerCss).find((rule) => rule.selector === '.mk-drawer .mk-drawer__body')
    expect(body?.body).toContain('container-type: inline-size')
    expect(body?.body).toContain('container-name: mk-drawer')
    // 反面：整张表里不许再出现 `.ant-drawer-body`——那是「拿平台内部类当锚点」的写法。
    expect(drawerCss).not.toContain('.ant-drawer-body')
    expect(drawerCss).not.toMatch(/\.ant-drawer-body\b/u)
    // 正向：这个类用 `flush`（正文自带 chrome），内距归它自己；档位只有 16（主档）。
    expect(body?.body).toContain('padding: 16px')
    // 正文原来的 14 不在间距主档（4/6/8/10/12/16）上，直接消失：这一条规则里不许再出现它。
    expect(body?.body).not.toContain('14px')
  })

  it('passes that class to the platform drawer instead of relying on antd internals', () => {
    const source = readFileSync(new URL('./MacroIndicatorDrawer.tsx', import.meta.url), 'utf8')
    // 断在**使用处**：`bodyClassName` 必须真的传给那个 Drawer，且值就是 CSS 里那个类。
    expect(source).toMatch(/<Drawer[\s\S]*?bodyClassName="mk-drawer__body"/u)
    // 内距不走 `default` 再叠一层：正文自带 chrome，用 `flush`。
    expect(source).toMatch(/<Drawer[\s\S]*?contentPadding="flush"/u)
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
