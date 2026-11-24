// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

import { ClockCard } from './ClockCard'
import {
  buildClockCardModel, clockCardCenter, clockCardGeometry, clockArrowGeometry, clockRingPoint,
  type ClockScheduleMetric
} from './clockCardModel'
import { clockSvgGeometry } from './clockCardSvg'
import { clockCardText } from './clockCardText'

const text = clockCardText['zh-CN']
const today = '2026-11-24'

const build = (input: Omit<Parameters<typeof buildClockCardModel>[0], 'names' | 'categoryNames'>):
ReturnType<typeof buildClockCardModel> => buildClockCardModel({
  names: text.names, categoryNames: text.categories, ...input
})

/** 真库形状（2026-11-24）：核心 PCE 1 天后、非农 10 天、政策 12-09 15 天、CPI 12-10 16 天。 */
const metrics: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
    nextRelease: { date: '2026-11-25', expected: '3.12%', expectedFromMarket: true as const } },
  { metricKey: 'US.CORE_PCE.MOM', nameKey: 'corePceMom', nextRelease: { date: '2026-11-25' } },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    nextRelease: { date: '2026-12-04', expected: '+88K', expectedFromMarket: true as const }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-12-09', expected: '92.9%' }, periodDays: 42, policyOutcome: 'hike-25' },
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
    nextRelease: { date: '2026-12-10', expected: '3.7%', expectedFromMarket: true as const }, periodDays: 30 }
]

let root: Root | null = null
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren() })

async function render(overrides: Partial<Parameters<typeof ClockCard>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const opened: string[] = []
  await act(async () => root!.render(<ClockCard
    model={build({ today, metrics })}
    text={text}
    actionLabelKey="pages.intelligence.portal.calendarCard.openCalendar"
    onOpenDetail={() => opened.push('detail')}
    onOpenCalendar={() => opened.push('calendar')}
    resolveText={(key) => key}
    {...overrides}
  />))
  return { host, opened }
}

/** 四支箭头的路径点必须落在 r101（箭尖）或 r91（箭底）上。 */
it('draws one arrow per category, tip on the orbit and base inside it', async () => {
  const { host } = await render()
  const arrows = [...host.querySelectorAll<SVGPathElement>('path.mi-clock__arrow')]
  expect(arrows.map((arrow) => arrow.getAttribute('class'))).toEqual([
    'mi-clock__arrow is-rate', 'mi-clock__arrow is-cpi', 'mi-clock__arrow is-payrolls', 'mi-clock__arrow is-pce'
  ])
  for (const arrow of arrows) {
    const d = arrow.getAttribute('d') ?? ''
    for (const [, , x, y] of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/gu)) {
      const radius = Math.hypot(Number(x) - clockCardCenter.svgX, Number(y) - clockCardCenter.svgY)
      expect([clockArrowGeometry.baseRadius, clockArrowGeometry.tipRadius]
        .some((value) => Math.abs(radius - value) <= 1.5), `${arrow.getAttribute('class')} 的点在 r71 或 r81 上`).toBe(true)
    }
  }
  // 箭头是装饰：读者读的是名字，图形本身不进无障碍树。
  for (const arrow of arrows) expect(arrow.getAttribute('aria-hidden')).toBe('true')
})

/** 名字挂在轨道外侧：四个真按钮，各自带「类名 + 日期 + 天数」的可访问名。 */
it('hangs four category names outside the ring, each a real button', async () => {
  const { host } = await render()
  const names = [...host.querySelectorAll<HTMLButtonElement>('button.mi-clock__category-name')]
  expect(names.map((name) => name.textContent)).toEqual(['利率', 'CPI', '非农', 'PCE'])
  expect(names[0]!.getAttribute('aria-label')).toBe('利率，12–09 · 15 天后')
  expect(names[1]!.getAttribute('aria-label')).toBe('CPI，12–10 · 16 天后')
  // 每个名字盒的位置来自模型（`left/top` 是盒子中心，CSS 用 translate(-50%,-50%) 居中）。
  for (const name of names) {
    // Popover 会把自己的锚点 span 包在按钮外面，所以要往上找到名字盒本身。
    const box = name.closest<HTMLElement>('.mi-clock__category')!
    expect(box.style.left, '名字盒的 left 来自模型').not.toBe('')
    expect(box.style.top).not.toBe('')
  }
})

/** 名字绝对定位、四类箭头各自的颜色、12 点只剩圆点：都钉在样式表里。 */
it('positions the names absolutely and colours only the arrows', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const category = /\.mi-clock__category \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(category, '名字必须是绝对定位（少了它四个名字会落回文档流）').toMatch(/position:\s*absolute/u)
  expect(category).toMatch(/translate\(-50%,\s*-50%\)/u)
  for (const [categoryKey, token] of [
    ['rate', '--mi-clock-cat-rate'], ['cpi', '--mi-clock-cat-cpi'],
    ['payrolls', '--mi-clock-cat-payrolls'], ['pce', '--mi-clock-cat-pce']
  ] as const) {
    expect(css, `${categoryKey} 的箭头颜色`).toContain(`.mi-clock__arrow.is-${categoryKey} { fill: var(${token});`)
  }
  // 名字不跟着染色（浅色主题下青色做 11px 文字不过线）：名字的颜色只有 --text。
  const nameRule = /\.mi-clock__category-name \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(nameRule).toContain('color: var(--text)')
  expect(nameRule).not.toContain('--mi-clock-cat-')
})

/** 「现在」那支三角删掉（用户 2026-11）：环上只留四支类别箭头。 */
it('drops the 12 o’clock triangle, keeping only a dot', async () => {
  const { host } = await render()
  const paths = [...host.querySelectorAll<SVGPathElement>('path')].map((path) => path.getAttribute('d'))
  expect(paths).not.toContain(clockSvgGeometry.pointer)
  const nowText = [...host.querySelectorAll('text')].map((node) => node.textContent)
  expect(nowText).not.toContain('现在')
  // 12 点仍有一颗圆点（位置标记，不是断口收口）。
  expect(host.querySelector('circle.mi-clock__nowmark')).not.toBeNull()
})

/** 底部溢出行整行删掉（用户 2026-11：「本来就是几个大类」）。 */
it('no longer renders the overflow line', async () => {
  const { host } = await render()
  expect(host.querySelector('[data-clock-overflow]')).toBeNull()
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).not.toContain('.mi-clock__overflow')
})

/**
 * 数据形状不合（宿主还在传上一版）时**不白屏**：整卡换成「暂时读不到」。
 * 2026-11-24 真机就是在这里白掉的。
 */
it('shows 暂时读不到 instead of crashing when the model shape is stale', async () => {
  const { host } = await render({ model: { center: undefined } as never })
  expect(host.querySelector('[data-clock-shape-unreadable]')?.textContent).toBe('暂时读不到')
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  const legacy = document.createElement('div')
  document.body.append(legacy)
  root = createRoot(legacy)
  await act(async () => root!.render(<ClockCard
    model={{ arrows: undefined, notes: undefined } as never}
    text={text}
    actionLabelKey="pages.intelligence.portal.calendarCard.openCalendar"
    onOpenDetail={() => undefined}
    onOpenCalendar={() => undefined}
    resolveText={(key) => key} />))
  expect(legacy.querySelector('[data-clock-shape-unreadable]')).not.toBeNull()
})

/** 数据形状不合但不缺 categories 时也不炸（缺字段一律降级，不抛）。 */
it('degrades instead of throwing when only the ring fields are missing', async () => {
  const { host } = await render({ model: { arrows: [], notes: [], center: undefined } as never })
  expect(host.querySelector('[data-clock-shape-unreadable]')).toBeNull()
  expect(host.querySelectorAll('path.mi-clock__arrow')).toHaveLength(0)
})

/** 环上流光的旋转轴必须是环心（用户 2026-11「流光看不见了」）。 */
it('drives the flow animation from the ring centre, not from a hard-coded pixel', async () => {
  const { host } = await render()
  const card = host.querySelector<HTMLElement>('.mi-clock')!
  expect(card.style.getPropertyValue('--mi-clock-center-x')).toBe(`${clockCardCenter.svgX}px`)
  expect(card.style.getPropertyValue('--mi-clock-center-y')).toBe(`${clockCardCenter.svgY}px`)
  expect(clockCardCenter.svgX).toBe(clockCardGeometry.svgWidth / 2)
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const orbit = /\.mi-clock__orbit \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(orbit).toContain('transform-origin: var(--mi-clock-center-x')
  expect(orbit).not.toMatch(/transform-origin:\s*[\d.]+px/u)
})

/** 卡本体仍是 A 方案的 252×248（用户拍过），改尺寸要有人重新核一遍。 */
it('draws the card at the size the user asked for', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).toMatch(/\.mi-clock \{[^}]*width: 252px; height: 248px;/u)
  expect(css).toMatch(/\.mi-clock__svg \{[^}]*width: 234px; height: 230px;/u)
  expect(css).toMatch(/\.mi-clock__core \{[^}]*width: 120px;/u)
})

/** 环上不再有牌子：`.mi-clock__node` 那套连同样式一起删干净。 */
it('removed the plaque layer entirely', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).not.toContain('.mi-clock__node')
  expect(css).not.toContain('--mi-clock-plaque-max-width')
})
