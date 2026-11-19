// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

import { ClockCard } from './ClockCard'
import { buildClockCardModel, clockRingPoint, type ClockScheduleMetric } from './clockCardModel'
import { clockCardText } from './clockCardText'

const text = clockCardText['zh-CN']
const today = '2026-11-15'
const metrics: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', lastRelease: { date: '2026-11-10', value: '3.74%' },
    nextRelease: { date: '2026-12-10' }, periodDays: 30 },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-12-04' }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.HIKE_25', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' }, periodDays: 42 }
]

let root: Root | null = null
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren() })

async function render(overrides: Partial<Parameters<typeof ClockCard>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const opened: string[] = []
  await act(async () => root!.render(<ClockCard
    model={buildClockCardModel({ today, metrics })}
    text={text}
    actionLabelKey="pages.intelligence.portal.calendarCard.openCalendar"
    onOpenDetail={() => opened.push('detail')}
    onOpenCalendar={() => opened.push('calendar')}
    resolveText={(key) => key}
    {...overrides}
  />))
  return { host, opened }
}

it('puts the four plaques at the angles the schedule gives', async () => {
  const { host } = await render()
  const nodes = [...host.querySelectorAll<HTMLElement>('[data-clock-plaque]')]
  // 今天真实命中 4 块在上环：CPI 过去、非农过去/未来、政策利率未来。
  // CPI 下一期（25 天、200°）与政策利率（24 天、192°）相撞 19px，按规则让位给更近的政策利率。
  expect(nodes).toHaveLength(4)
  const cpiPast = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  const expected = clockRingPoint(300)
  expect(Number.parseFloat(cpiPast.style.left)).toBeCloseTo(expected.x, 2)
  expect(Number.parseFloat(cpiPast.style.top)).toBeCloseTo(expected.y, 2)
  // 牌上永远是「名字 + 数值」：名字在，值在；天数不出现在牌上。
  expect(cpiPast.textContent).toContain('CPI 年率')
  expect(cpiPast.textContent).toContain('3.74%')
  expect(cpiPast.textContent).not.toContain('天')
})

it('drives each future plaque’s opacity from its position, not from a timer', async () => {
  const { host } = await render()
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.HIKE_25"]')!
  expect(policy.style.getPropertyValue('--o')).toBe('0.82')
  const payrolls = host.querySelector<HTMLElement>('[data-clock-metric="US.NONFARM.SA.CHANGE"][data-clock-plaque="future"]')!
  expect(Number(payrolls.style.getPropertyValue('--o'))).toBeCloseTo(0.7006, 4)
  // 过去牌不参与透明度：固定 1。
  const past = host.querySelector<HTMLElement>('[data-clock-metric="US.NONFARM.SA.CHANGE"][data-clock-plaque="past"]')!
  expect(past.style.getPropertyValue('--o')).toBe('1')
})

it('writes 预期未提供 in the centre when the next release has no consensus, never a sample value', async () => {
  const { host } = await render()
  expect(host.querySelector('.mi-clock__value')?.textContent).toBe(text.expectationMissing)
  expect(host.textContent).not.toContain('142K')
  // 前值照旧写出来：拿不到的是预期，不是前值。
  expect(host.querySelector('.mi-clock__tier')?.textContent).toContain('+165K')
})

it('opens the calendar drawer from the overlay icon and names it for a screen reader', async () => {
  const { host, opened } = await render()
  const icon = host.querySelector<HTMLButtonElement>('.mi-clock__action button')!
  expect(icon.getAttribute('aria-label')).toBe('pages.intelligence.portal.calendarCard.openCalendar')
  await act(async () => icon.click())
  expect(opened).toEqual(['calendar'])
})

it('hands the crowded plaque a line that names it and says how many days out it is', async () => {
  const { host } = await render()
  const info = host.querySelector<HTMLElement>('.mi-clock__info')!
  expect(info.getAttribute('data-clock-unplaced')).toBe('1')
  expect(info.getAttribute('title')).toContain('另有 1 项未上环：CPI 年率 25 天后')
})

it('leaves a line for a metric it cannot place instead of dropping it silently', async () => {
  const model = buildClockCardModel({ today, metrics: [
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', lastRelease: { date: '2026-11-13', value: '1' }, periodDays: 30 }
  ] })
  const { host } = await render({ model })
  const info = host.querySelector<HTMLElement>('.mi-clock__info')!
  expect(info.getAttribute('data-clock-unplaced')).toBe('1')
  expect(info.getAttribute('title')).toContain('CPI 年率 未上环：没有下一期日程')
})

/**
 * 用户 2026-11-20 报的两处「看着像数据错了」：
 * ① 大号数值其实是**市场共识**，标签原来写在数值下面，读者把它当成实际值、把标签当成空值；
 * ② 政策利率那一格的值是**盘口主推档概率**，名字却只写「政策利率」，90.9% 会被读成利率水平。
 */
it('puts the expectation label above the number, so the number is not read as the actual', async () => {
  const withExpected = [{ metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-11-25', expected: '+88K' }, periodDays: 28 }]
  const { host } = await render({ model: buildClockCardModel({ today, metrics: withExpected }) })
  const core = host.querySelector('.mi-clock__core')!
  const unit = core.querySelector('.mi-clock__unit')
  const value = core.querySelector('.mi-clock__value')
  expect(unit, '主位必须有「预期（市场共识）」这行').not.toBeNull()
  expect(value?.textContent).toBe('+88K')
  // 顺序：标签在前、数值在后（读屏与视觉一致）。
  expect(unit!.compareDocumentPosition(value!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('names the policy slot as a probability, never as the rate itself', async () => {
  const policy = [{ metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-11-25', expected: '90.9%' }, periodDays: 28 }]
  const { host } = await render({ model: buildClockCardModel({ today, metrics: policy }) })
  // 中央主位与环上的牌都用同一个名字：说清「这是维持不变的概率」。
  expect(host.textContent).toContain('维持不变概率')
  expect(host.querySelector('.mi-clock__core')?.textContent).not.toBe('政策利率90.9%')
})

/**
 * 环流高光（界面设计 2026-11-20）：装饰性流动，**不是加载信号**。
 *
 * 三条硬约束在这里钉住：① 推进用 `stroke-dashoffset`，**不许出现 `transform: rotate`**
 * （旋转只归 `loadingState`）；② 减少动态效果时不播，但亮斑**静态仍在位**；③ 亮斑被外层
 * 断口裁剪包着，不会从缺口漏过去。
 */


it('renders the expectation label in full, never truncated with an ellipsis', async () => {
  const withExpected = [{ metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-11-25', expected: '+88K' }, periodDays: 28 }]
  const { host } = await render({ model: buildClockCardModel({ today, metrics: withExpected }) })
  const unit = host.querySelector('.mi-clock__unit')!
  expect(unit.textContent).toBe('预期（市场共识）')
  // 放不下时缩小字档而不是省略号：这条格不许有省略/裁剪规则。
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const unitRule = /\.mi-clock__unit\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(unitRule).not.toContain('text-overflow')
})

/**
 * 相位核对（Chief 2026-11-20 问：为什么是 212 → −636，而不是 0 → −848）。
 *
 * **实测依据**：这条高光画在 `<circle>` 上，而 circle 的路径起点是**几何 3 点方向的 (cx+r, cy)**，
 * 不是 12 点。所以要把亮斑摆到 12 点，必须先把图案往回推 90°，即 848/4 ≈ **212**。
 * `dashoffset` 为 212 时，亮斑起点 = 3 点方向逆时针（回推）90° = 12 点：`(cx, cy − r)`。
 *
 * 这条同时是**防回归**：谁照规格把 0 → −848 搬回来，亮斑就会偏到 3 点方向，这里立刻红。
 */

/**
 * **CSS 里的 `stroke-dashoffset` 必须带单位**（Chief 2026-11-20 找到的真根因）。
 *
 * CSS 只接受 `<length>` / `<percentage>`，非零裸数字是非法值、整条声明被丢弃 → 整组 keyframes 变空
 * → 动画完全不生效（元素只停在 SVG **属性**给的 212 上，看起来一动不动）。
 * 属性里写数字合法（用户单位），CSS 里不合法：两个解析器，别混。
 *
 * 原来那条用例断的是**属性**上的 212，所以「用例绿、行为没生效」——这条专门断 CSS 声明本身。
 */

/**
 * 几何断言（Chief 2026-11-20 抓到的真凶）：亮斑画在 r=135，而包住它的裁剪遮罩曾经只覆盖
 * 半径 102.5~105.5 —— **整条高光被裁掉，屏幕上从来没有出现过它**（动画不动只是表层）。
 *
 * 重新生成的环带遮罩必须覆盖 `orbitRadius ± 1.5`；把半径改回 102.5 这类值，这条当场红。
 */

/**
 * 装饰性流光（用户 2026-11-20 纠正方向：**不是新加一条，是把原来那条转回来**）。
 *
 * - 转的是 `.mi-clock__orbit` 里那扇渐变光，`mi-clock-spin 8s linear infinite`；
 * - 11-15 那次为了过「旋转只许加载态」把它删了、还加了 `display: none`——所以它是被藏起来的；
 * - 现在恢复旋转，并且**减少动态效果下只是不转、不许隐藏**（不是 `display: none`）。
 */
it('turns the existing orbit glow again, and keeps it visible when motion is reduced', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).toMatch(/\.mi-clock__orbit\s*\{[^}]*animation:\s*mi-clock-spin 8s linear infinite/u)
  expect(css).toContain('@keyframes mi-clock-spin { to { transform: rotate(360deg); } }')
  const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? ''
  expect(reduced).toContain('.mi-clock__orbit { animation: none; }')
  // 关键：减少动态**不许**把它藏起来（旧实现那句 display:none 就是让人以为坏了的根因）。
  expect(css).not.toMatch(/\.mi-clock__orbit\s*\{[^}]*display:\s*none/u)
})

it('renders the orbit glow that spins', async () => {
  const { host } = await render()
  const orbit = host.querySelector('.mi-clock__orbit')
  expect(orbit).not.toBeNull()
  expect(orbit!.querySelector('path')).not.toBeNull()
})
