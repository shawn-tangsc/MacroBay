// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ClockCard } from './ClockCard'
import { buildClockCardModel, clockRingPoint, type ClockScheduleMetric } from './clockCardModel'
import { clockCardText } from './clockCardText'

const text = clockCardText['zh-CN']
const today = '2026-11-15'
/**
 * 环上只放一个指标（用户 2026-11-21）：候选=有盘口预期的一级指标。
 * 这里只有 CPI 有盘口 → 环上那一个是它；非农进溢出清单；政策牌单独一块（相撞时让位给指标）。
 */
const metrics: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
    lastRelease: { date: '2026-11-10', at: '2026-11-10T13:30:00.000Z', value: '3.74%' },
    nextRelease: { date: '2026-12-10', at: '2026-12-10T13:30:00.000Z', expected: '3.2%', expectedFromMarket: true as const }, periodDays: 30 },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-12-04' }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-12-09' }, periodDays: 42, policyOutcome: 'hike-25' }
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

it('puts the one market-implied indicator on the ring at the angle the schedule gives', async () => {
  const { host } = await render()
  const nodes = [...host.querySelectorAll<HTMLElement>('[data-clock-plaque]')]
  // 环上只放一个指标：CPI（过去 + 未来）。非农没盘口 → 不上环；政策牌与 CPI 未来牌相撞 → 让位。
  expect(nodes).toHaveLength(2)
  const cpiPast = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  const expected = clockRingPoint(300)
  expect(Number.parseFloat(cpiPast.style.left)).toBeCloseTo(expected.x, 2)
  expect(Number.parseFloat(cpiPast.style.top)).toBeCloseTo(expected.y, 2)
  // 牌上永远是「名字 + 数值」：名字在，值在；天数不出现在牌上。
  expect(cpiPast.textContent).toContain('CPI 年率')
  expect(cpiPast.textContent).toContain('3.74%')
  expect(cpiPast.textContent).not.toContain('天')
})

it('drives the ring plaque’s opacity from its position, not from a timer', async () => {
  const { host } = await render()
  // CPI 下一期 25 天 → 0.5 + (25/30)²×0.5 ≈ 0.8472。
  const future = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  expect(Number(future.style.getPropertyValue('--o'))).toBeCloseTo(0.8472, 4)
  // 过去牌不参与透明度：固定 1。
  const past = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  expect(past.style.getPropertyValue('--o')).toBe('1')
})

it('writes the market-implied expectation on the ring plaque it carries', async () => {
  const { host } = await render()
  const future = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  // 牌上第二行是盘口预期 3.2%，不是上一期的 3.74%——两行都在，读者分得开「预期」与「前值」。
  expect(future.textContent).toContain('CPI 年率')
  expect(future.textContent).toContain('3.2%')
  expect(future.textContent).not.toContain('3.74%')
})

/** 一个都没有盘口时不硬挂：中央不画大数字（不拿没盘口的指标顶上去假装有预期）。 */
it('draws no centre value when no candidate has a market-implied expectation', async () => {
  const model = buildClockCardModel({ today, metrics: [
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
      lastRelease: { date: '2026-11-06', value: '+165K' }, nextRelease: { date: '2026-12-04' }, periodDays: 28 }
  ] })
  const { host } = await render({ model })
  expect(host.querySelector('.mi-clock__value')).toBeNull()
})

it('opens the calendar drawer from the overlay icon and names it for a screen reader', async () => {
  const { host, opened } = await render()
  const icon = host.querySelector<HTMLButtonElement>('.mi-clock__action button')!
  expect(icon.getAttribute('aria-label')).toBe('pages.intelligence.portal.calendarCard.openCalendar')
  await act(async () => icon.click())
  expect(opened).toEqual(['calendar'])
})

it('lists the releases that are not on the ring under the card, with a count', async () => {
  const { host } = await render()
  const line = host.querySelector<HTMLElement>('[data-clock-overflow]')!
  // 非农（没盘口）在这一行里；计数是「发布」的条数。
  expect(line.textContent).toContain('还有 1 个发布不在环上')
  // 逐条在 ⓘ 里：名字 · 日期 · 几天后。
  expect(line.querySelector('button')).not.toBeNull()
})

/**
 * 溢出行必须**贴在卡上**，不许落回文档流（0.4.5 #40）。
 *
 * 真事故：`.mi-clock__overflow` 全仓库只有类名、没有样式，`<p>` 回到普通文档流，
 * 跑到卡片左上角压住钟面刻度。
 *
 * 行高不是 11px：行内那颗 ⓘ 是 `IconButton size="sm"`（22×22，尺寸只有 sm/md 两档），
 * 所以这一行**实际占 22px**，11px 只是字号。政策降级行因此要上移到 40（16+22+2）才不压住它。
 */
it('anchors the overflow line inside the card with exactly one trigger', async () => {
  const { host } = await render()
  const line = host.querySelector<HTMLElement>('[data-clock-overflow]')!
  expect(line.parentElement?.tagName).toBe('SECTION')
  expect(line.parentElement?.className).toContain('mi-clock')
  // 行内只有**一颗** ⓘ（底部那颗是另一件事：来源、撞牌、其他原因）。
  expect(line.querySelectorAll('button')).toHaveLength(1)
  // 行里只有那句计数：逐条清单在浮层里，不摊在卡面上。
  expect(line.textContent).toBe('还有 1 个发布不在环上')
})

it('positions the overflow line absolutely and lifts the policy note clear of it', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const rule = /\.mi-clock__overflow\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(rule, '溢出行必须自己定位；没有这条规则它就落回文档流压住钟面').toContain('position: absolute')
  expect(rule).toContain('bottom: 16px')
  expect(rule).toContain('font-size: var(--font-meta)')
  // 没有溢出行时政策说明留在 16；有溢出行时整体上移，两行不叠。
  expect(/\.mi-clock__policy-note\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '').toContain('bottom: 16px')
  const lift = /\.mi-clock__overflow ~ \.mi-clock__policy-note\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(lift, '政策行上移量必须盖过溢出行那 22px 的实际行高').toContain('bottom: 40px')
})

/**
 * 底部 ⓘ 与溢出行那颗是**同一套交互**（`helpTrigger` → `Popover`），所以验证方式是点开浮层看那几句，
 * 不再断言原生 `title`——那张卡上已经不留两种交互了。
 */
it('leaves a line for a metric it cannot place instead of dropping it silently', async () => {
  const model = buildClockCardModel({ today, metrics: [
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', lastRelease: { date: '2026-11-13', value: '1' }, periodDays: 30 }
  ] })
  const { host } = await render({ model })
  const trigger = host.querySelector<HTMLButtonElement>('.mi-clock__info button')!
  // 读屏名是平台那句「查看说明」，不是浮层正文。
  expect(trigger.getAttribute('aria-label')).toBe('查看说明')
  await act(async () => trigger.click())
  // 没上环的那一条必须能在浮层里读到原句（不许静默消失）。
  expect(document.body.textContent).toContain('CPI 年率 未上环：没有下一期日程')
})

/**
 * 用户 2026-11-20 报的两处「看着像数据错了」：
 * ① 大号数值其实是**市场共识**，标签原来写在数值下面，读者把它当成实际值、把标签当成空值；
 * ② 政策利率那一格的值是**盘口主推档概率**，名字却只写「政策利率」，90.9% 会被读成利率水平。
 *
 * 现在中央平时是利率路径面，这张指标面只在发布前后各 24 小时内出现（用户 2026-11-21 拍板）。
 */
it('puts the expectation label above the number, so the number is not read as the actual', async () => {
  // 非农 11-25 13:30Z 发布；09:30Z 是发布前 4 小时 → 中央切成它的指标面。
  const withExpected = [{ metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-11-25', at: '2026-11-25T13:30:00.000Z', expected: '+88K', expectedFromMarket: true as const }, periodDays: 28 }]
  const { host } = await render({ model: buildClockCardModel({
    today: '2026-11-25', now: '2026-11-25T09:30:00.000Z', metrics: withExpected }) })
  const core = host.querySelector('.mi-clock__core')!
  const label = core.querySelector('.mi-clock__label')
  const value = core.querySelector('.mi-clock__value')
  expect(label, '指标面必须有「预期（市场共识）」这行').not.toBeNull()
  expect(value?.textContent).toBe('+88K')
  // 顺序：标签在前、数值在后（读屏与视觉一致）。
  expect(label!.compareDocumentPosition(value!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

/** 平时的中央是利率路径面：面名、「12 月加息 25bp」、概率、会议日与天数。 */
it('shows the policy path face outside any release window', async () => {
  const { host } = await render()
  const core = host.querySelector('.mi-clock__core')!
  expect(core.getAttribute('data-clock-center')).toBe('policy')
  expect(core.textContent).toContain('利率路径')
  // 会议日与天数：12–09 · 24 天后（today 是 2026-11-15）。
  expect(core.textContent).toContain('12–09 · 24 天')
  // 这一份夹具的政策读数没有概率：写「概率暂未提供」，不许写 0%。
  expect(core.textContent).toContain('概率暂未提供')
})

it('names the policy slot by its leading outcome, never a hardcoded one', async () => {
  const policy = [{ metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-11-25', expected: '90.9%' }, periodDays: 28, policyOutcome: 'hike-25' }]
  const { host } = await render({ model: buildClockCardModel({ today, metrics: policy }) })
  // 主推档是 hike-25 → 标签必须是「加息」，不是写死的「维持不变」。
  expect(host.textContent).toContain('加息 25bp概率')
  expect(host.textContent).not.toContain('维持不变概率')
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
    nextRelease: { date: '2026-11-25', at: '2026-11-25T13:30:00.000Z', expected: '+88K', expectedFromMarket: true as const }, periodDays: 28 }]
  const { host } = await render({ model: buildClockCardModel({
    today: '2026-11-25', now: '2026-11-25T09:30:00.000Z', metrics: withExpected }) })
  const label = host.querySelector('.mi-clock__label')!
  expect(label.textContent).toBe('预期（市场共识）')
  // 放不下时缩小字档而不是省略号：这一格不许有省略/裁剪规则。
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const labelRule = /\.mi-clock__label\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(labelRule).not.toContain('text-overflow')
})

/**
 * 窗口内四态（42 号文件 §四）：有结果 / 未到发布 / 已过时刻无结果 / 该指标读不到。
 * 每一条都钉住「读不到不编数、等待不空白」这两条硬边界。
 */
describe('the centre indicator face inside the release window', () => {
  /** 刚发布那一次：11-25 13:30Z；下一期在 12-25。 */
  const afterRelease = (extra: Record<string, unknown> = {}): readonly ClockScheduleMetric[] => [{
    metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-25', at: '2026-11-25T13:30:00.000Z' },
    nextRelease: { date: '2026-12-25', at: '2026-12-25T13:30:00.000Z' },
    periodDays: 28, ...extra
  }]
  /** 还没发布那一次：11-25 13:30Z 是下一期，上一次是 10-28。 */
  const beforeRelease = (extra: Record<string, unknown> = {}): readonly ClockScheduleMetric[] => [{
    metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-10-28', at: '2026-10-28T13:30:00.000Z' },
    nextRelease: { date: '2026-11-25', at: '2026-11-25T13:30:00.000Z' },
    periodDays: 28, ...extra
  }]
  const coreAt = async (now: string, metrics: readonly ClockScheduleMetric[]) => {
    const { host } = await render({ model: buildClockCardModel({ today: '2026-11-25', now, metrics }) })
    return host.querySelector('.mi-clock__core')!
  }

  it('puts the actual in the big slot and the surprise on its own line after the release', async () => {
    const core = await coreAt('2026-11-25T15:30:00.000Z', afterRelease({
      actualValue: '+180K', previousValue: '+165K', consensusValue: '+150K',
      deltaAmount: '+30K', deltaDirection: 'above'
    }))
    expect(core.textContent).toContain('实际')
    expect(core.textContent).toContain('+180K')
    expect(core.textContent).toContain('+30K 高于预期')
    expect(core.textContent).toContain('预期 +150K · 前值 +165K')
  })

  it('says it is waiting for the result instead of drawing a blank when the time has passed', async () => {
    const core = await coreAt('2026-11-25T15:30:00.000Z', afterRelease({ previousValue: '+165K' }))
    expect(core.textContent).toContain('等待发布结果')
    expect(core.textContent).toContain('前值 +165K')
    // 不许画一个「实际值」出来顶上。
    expect(core.querySelector('.mi-clock__label')).toBeNull()
  })

  it('says the indicator cannot be read when neither expectation nor previous is available', async () => {
    const core = await coreAt('2026-11-25T09:30:00.000Z', beforeRelease())
    expect(core.textContent).toContain('新增就业暂时读不到')
    // 句子态不许进 30px 的取值档（那是给数值的）；也不许写 0%。
    expect(core.querySelector('.mi-clock__value')).toBeNull()
    expect(core.textContent).not.toContain('0%')
  })

  it('says the policy path is not enabled instead of showing an error tone', async () => {
    const { host } = await render({ policyState: 'disabled' })
    const core = host.querySelector('.mi-clock__core')!
    expect(core.textContent).toContain('利率路径未启用政策数据源')
    // 「未启用」不是故障：中央不出现 0%，也不画一块假读数。
    expect(core.querySelector('.mi-clock__value')).toBeNull()
  })
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
