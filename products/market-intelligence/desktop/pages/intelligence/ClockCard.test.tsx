// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ClockCard } from './ClockCard'
import {
  buildClockCardModel, clockCardCenter, clockCardGeometry, clockPlaqueMaxWidth, clockPlaqueMinWidth,
  clockPlaqueOneLineHeight, clockPlaqueOverlayZ, clockPlaqueRaisedZ, clockRingPoint,
  type ClockScheduleMetric
} from './clockCardModel'
import { clockCardText } from './clockCardText'

const text = clockCardText['zh-CN']
const today = '2026-11-21'

/** 牌宽随名字走：布局要按解析后的名字估盒子，所以每处都带上文案表里的名字。 */
const build = (input: Omit<Parameters<typeof buildClockCardModel>[0], 'plaqueNames'>): ReturnType<typeof buildClockCardModel> =>
  buildClockCardModel({ plaqueNames: text.names, ...input })
/**
 * 真库形状（用户 2026-11-21 更正「CPI 非农怎么没了」）：**每个发布日一块牌**。
 * 12-04 非农、12-10 CPI 各一块，CPI 还有 11-19 刚发布过的过去牌；政策 12-09 与 CPI 未来牌相撞 → 让位。
 */
const metrics: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
    lastRelease: { date: '2026-11-19', at: '2026-11-19T13:30:00.000Z', value: '3.74%' },
    nextRelease: { date: '2026-12-10', at: '2026-12-10T13:30:00.000Z', expected: '3.2%', expectedFromMarket: true as const }, periodDays: 30 },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-12-04' }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-12-09' }, periodDays: 42, policyOutcome: 'hike-25' }
]

/** 单独一块 CPI（不与政策相撞）：测牌自己的透明度与数值，不掺合并。 */
const cpiOnly: ClockScheduleMetric = {
  metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
  lastRelease: { date: '2026-11-19', at: '2026-11-19T13:30:00.000Z', value: '3.74%' },
  nextRelease: { date: '2026-12-10', at: '2026-12-10T13:30:00.000Z', expected: '3.2%', expectedFromMarket: true as const },
  periodDays: 30
}

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

it('rings one plaque per release date at the angle the schedule gives', async () => {
  const { host } = await render()
  const nodes = [...host.querySelectorAll<HTMLElement>('[data-clock-plaque]')]
  // 每个发布日一块：12-04 非农、12-09 政策、12-10 CPI 各自一块，CPI 还有 11-19 的过去牌。
  // 政策与 CPI 只差一天也**不合并**（用户 2026-11-21 改口径）：两块各自一块牌，近了就叠。
  expect(nodes.map((node) => `${node.dataset.clockPlaque}:${node.dataset.clockMetric}`).sort())
    .toEqual(['future:US.CPI.NSA.YOY', 'future:US.NONFARM.SA.CHANGE', 'future:US.TARGET_RATE.DECISION', 'past:US.CPI.NSA.YOY'])
  expect(host.querySelector('[data-clock-merged]'), '合并牌已经撤掉，不许再出现').toBeNull()
  const cpiPast = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  // 11-19 发布、P=30、今天 11-21 → 2 天 → 360 − 2/30×360 = 336°。
  const expected = clockRingPoint(336)
  expect(Number.parseFloat(cpiPast.style.left)).toBeCloseTo(expected.x, 2)
  expect(Number.parseFloat(cpiPast.style.top)).toBeCloseTo(expected.y, 2)
  // 牌上是「名字 + 值 + 距离」（用户 2026-11：「距离时间呢？」）：过去牌写「N 天前」。
  expect(cpiPast.textContent).toContain('CPI 年率')
  expect(cpiPast.textContent).toContain('3.74%')
  expect(cpiPast.textContent).toContain('2 天前')
})

it('drives the ring plaque’s opacity from its position, not from a timer', async () => {
  const { host } = await render({ model: build({ today, metrics: [cpiOnly] }) })
  // CPI 下一期 19 天 → 0.5 + (19/30)²×0.5 ≈ 0.7006。
  const future = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  expect(Number(future.style.getPropertyValue('--o'))).toBeCloseTo(0.7006, 4)
  // 过去牌不参与透明度：固定 1。
  const past = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  expect(past.style.getPropertyValue('--o')).toBe('1')
})

it('writes the market-implied expectation on the ring plaque it carries', async () => {
  const { host } = await render({ model: build({ today, metrics: [cpiOnly] }) })
  const future = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  // 牌上第二行是盘口预期 3.2%，不是上一期的 3.74%——两行都在，读者分得开「预期」与「前值」。
  expect(future.textContent).toContain('CPI 年率')
  expect(future.textContent).toContain('3.2%')
  expect(future.textContent).not.toContain('3.74%')
})

/** 一个都没有盘口时不硬挂：中央不画大数字（不拿没盘口的指标顶上去假装有预期）。 */
it('draws no centre value when no candidate has a market-implied expectation', async () => {
  const model = build({ today, metrics: [
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

/** 同一天多个一级指标：只上一块牌，其余进溢出行（名字 · 日期 · 几天后）。 */
const sameDayPair: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
    nextRelease: { date: '2026-12-11', expected: '3.1%', expectedFromMarket: true as const } },
  { metricKey: 'US.CORE_PCE.MOM', nameKey: 'corePceMom', nextRelease: { date: '2026-12-11' } }
]

it('lists the same-day releases that did not make the ring, with a count', async () => {
  const { host } = await render({ model: build({ today, metrics: sameDayPair }) })
  const line = host.querySelector<HTMLElement>('[data-clock-overflow]')!
  // 12-11 只上一块（有盘口的 PCE 年率），PCE 月率在这一行里。
  expect(line.textContent).toContain('还有 1 个发布不在环上')
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
  const { host } = await render({ model: build({ today, metrics: sameDayPair }) })
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
  const model = build({ today, metrics: [
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
  const { host } = await render({ model: build({
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
  // 会议日与天数：12–09 · 18 天后（today 是 2026-11-21）。
  expect(core.textContent).toContain('12–09 · 18 天')
  // 这一份夹具的政策读数没有概率：写「概率暂未提供」，不许写 0%。
  expect(core.textContent).toContain('概率暂未提供')
})

it('rings the policy event by name and leaves the odds to the centre', async () => {
  const policy = [{ metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-11-25', expected: '90.9%' }, periodDays: 28, policyOutcome: 'hike-25' }]
  const { host } = await render({ model: build({ today, metrics: policy }) })
  // 牌上只有名字 + 距离，概率不重复（用户 2026-11：中央显示概率是对的，缺的是天数上环）。
  const plaque = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  expect(plaque.textContent).toContain('政策利率')
  expect(plaque.textContent).toContain('4 天后')
  expect(plaque.textContent).not.toContain('90.9%')
  // 中央：档名按主推档生成（hike-25 →「加息 25bp」），不是写死的「维持」。
  const core = host.querySelector('.mi-clock__core')!
  expect(core.textContent).toContain('加息 25bp')
  expect(core.textContent).toContain('90.9%')
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
  const { host } = await render({ model: build({
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
    const { host } = await render({ model: build({ today: '2026-11-25', now, metrics }) })
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

/**
 * 牌子宽度上限只有一处事实：模型里用于横向夹取的值，必须与 CSS 里那盒子的上限同一个数。
 * 两处各写一份、某天只改一边，牌子又会被夹出卡外或撑破卡缘。
 */
/**
 * 环上流光的旋转轴必须是环心（用户 2026-11：「流光看不见了」）。
 *
 * 它曾经写死成 `transform-origin: 156px 153px`（旧卡的圆心）。卡缩到 252×248 后轴偏出 39px，
 * 光斑被转到环外，肉眼就是「流光没了」。判据是**组件给的圆心变量 = 几何常量**，
 * 而且样式表里不许再出现字面像素圆心——换任何卡尺寸都不该再断一次。
 */
it('drives the flow animation from the ring centre, not from a hard-coded pixel', async () => {
  const { host } = await render()
  const card = host.querySelector<HTMLElement>('.mi-clock')!
  expect(card.style.getPropertyValue('--mi-clock-center-x')).toBe(`${clockCardCenter.svgX}px`)
  expect(card.style.getPropertyValue('--mi-clock-center-y')).toBe(`${clockCardCenter.svgY}px`)
  // 环心就是 SVG 画布中心：换尺寸时两者一起走，轴不会偏。
  expect(clockCardCenter.svgX).toBe(clockCardGeometry.svgWidth / 2)
  expect(clockCardCenter.svgY).toBe(clockCardGeometry.svgHeight / 2)
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const orbit = /\.mi-clock__orbit \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(orbit, '旋转轴必须读组件给的变量').toContain('transform-origin: var(--mi-clock-center-x')
  expect(orbit, '不许再写死像素圆心').not.toMatch(/transform-origin:\s*[\d.]+px/u)
})

/**
 * 卡本体按 A 方案缩小（用户 2026-11：整体小四分之一）：252×248，内距 9 → SVG 234×230，
 * 中央块 120。几何常量在 `clockPlaqueLayout`，样式表必须同值，否则环会被裁。
 */
it('draws the card at the size the user asked for', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css, '卡本体').toMatch(/\.mi-clock \{[^}]*width: 252px; height: 248px;/u)
  expect(css, 'SVG 画布').toMatch(/\.mi-clock__svg \{[^}]*width: 234px; height: 230px;/u)
  expect(css, '中央块').toMatch(/\.mi-clock__core \{[^}]*width: 120px;/u)
})

it('keeps the plaque width limit identical in the model and the stylesheet', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).toContain(`--mi-clock-plaque-max-width: ${clockPlaqueMaxWidth}px`)
})

/**
 * 牌子的最小盒与「环上说明行的层级」也各只有一处事实：
 * 牌宽从 62 到 128 都要参与重叠计算，说明行必须压在牌子之上——两个数都不许在样式表里另有说法。
 */
it('keeps the plaque minimum box and the overlay layer identical in the model and the stylesheet', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(css).toContain(`--mi-clock-plaque-min-width: ${clockPlaqueMinWidth}px`)
  expect(css).toContain(`--mi-clock-plaque-min-height: ${clockPlaqueOneLineHeight}px`)
  expect(css).toContain(`--mi-clock-overlay-z: ${clockPlaqueOverlayZ}`)
})

/**
 * 层级只有一个来源（模型给的 `--mi-clock-z` + 抬起那一块的行内 z-index）：
 * 样式表里不许再写一个数字层级，也不许在悬停规则里跟行内层级比大小。
 */
it('takes the plaque stacking order from the model, never from a stylesheet constant', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const node = /\.mi-clock__node \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(node, '牌的层级必须读模型给的变量').toContain('z-index: var(--mi-clock-z, 4)')
  const hover = /\.mi-clock__node:hover[^{]*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(hover, '悬停只恢复不透明度；置顶由组件行内给，两处会比大小').not.toContain('z-index')
  expect(css, '中央主位那块沉底也由模型给，样式表不再单独写一层').not.toContain('.mi-clock__node[data-center] { z-index')
})

/**
 * 牌上必须有**距离时间**（用户 2026-11 看图第一句「距离时间呢？」）：
 * 只有名字和值，读者不知道离发布还有多久。未来牌写「N 天后」、过去牌写「N 天前」，
 * 距离与值同一行——牌高仍在 37–44px，不为它改时钟几何。
 */
it('puts the distance on every plaque, in the future and in the past', async () => {
  const { host } = await render()
  // 政策 12-09 自己一块牌，写自己的 18 天；CPI 那块写 19 天。
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  expect(policy.textContent).toContain('18 天后')
  const cpi = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  expect(cpi.textContent).toContain('19 天后')
  const past = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="past"]')!
  expect(past.textContent).toContain('2 天前')
})

/** 没有盘口预期的那块牌也要有距离——这正是读者要看的「还有几天」，不是「有没有数」。 */
it('shows the distance even when a plaque has no value', async () => {
  const { host } = await render({ model: build({ today, metrics: [
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
      nextRelease: { date: '2026-12-04' }, periodDays: 28 }
  ] }) })
  const node = host.querySelector<HTMLElement>('[data-clock-metric="US.NONFARM.SA.CHANGE"]')!
  expect(node.textContent).toContain('13 天后')
  // 没有预期就不显示数字（不拿编的数顶上）。
  expect(node.querySelector('b')).toBeNull()
})

/** 长名字（两行）+ 值 + 距离同时存在：三样都在，且仍是一块牌。 */
it('keeps a long name, its value and the distance in the same plaque', async () => {
  const { host } = await render({ model: build({ today, metrics: [
    { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
      nextRelease: { date: '2026-11-25', expected: '3.12%', expectedFromMarket: true as const } }
  ] }) })
  const nodes = host.querySelectorAll<HTMLElement>('[data-clock-plaque]')
  expect(nodes).toHaveLength(1)
  const node = nodes[0]!
  expect(node.textContent).toContain('核心 PCE 年率（季调）')
  expect(node.textContent).toContain('3.12%')
  expect(node.textContent).toContain('4 天后')
})

/**
 * 牌上时间的视觉定稿（界面设计候选 A，用户 2026-11：「时间不够醒目」）。
 *
 * 真因是对比度不达标（`--muted` 在牌底上 3.82:1，小字 AA 线 4.5），不是字号——
 * 所以只换颜色与字重：距离 `--text` + 650（9.50:1），值降一档 `--text-secondary` + 500（6.29:1）。
 * 不加新字号档、不染 `--accent`（它已经给了「现在」和环上高光）、不动几何。
 */
it('makes the distance the heaviest mark on the plaque, and keeps the value a step quieter', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const when = /\.mi-clock__node-when\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(when, '距离必须是牌上最亮的：--text').toContain('color: var(--text)')
  expect(when, '距离必须是牌上最重的：650').toContain('font-weight: 650')
  const value = /\.mi-clock__node b\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(value, '值降一档但仍过 AA').toContain('color: var(--text-secondary)')
  expect(value).toContain('font-weight: 500')
  expect(/\.mi-clock__node-meta\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '').toContain('gap: 6px')
})

it('keeps the distance on the only allowed size step, and never in the accent colour', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  const when = /\.mi-clock__node-when\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(when, '11px 是这张卡唯一可用档，不许新造字号档').toContain('font-size: var(--font-meta)')
  expect(when, '--accent 已用于「现在」与环上高光，第三处强调等于没有强调').not.toContain('--accent')
})

/**
 * 政策会议是**一件事件**（用户 2026-11）：「12-09 · 18 天」不能只写在中央，
 * 它要像其他指标一样在环上挂一块牌，写名字 + 还有几天；概率仍只在中央显示。
 */
it('rings the policy meeting as its own event, with its distance and no odds', async () => {
  const { host } = await render()
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  expect(policy, '政策会议必须在环上').not.toBeNull()
  expect(policy.textContent).toContain('政策利率')
  expect(policy.textContent).toContain('18 天后')
  // 概率不进牌（中央已经有），牌上不重复表达。
  expect(policy.textContent).not.toContain('89')
})

/**
 * 12-09 与 12-10 只差一天：**不合并**，两块各自一块牌、各写自己的名字与天数（用户 2026-11-21）。
 * 叠住是允许的，但叠多少由布局按常量封顶（见 `clockPlaqueOverlapCap`），牌上的字一个不少。
 */
it('keeps two adjacent dates as two plaques, each with its own name and distance', async () => {
  const { host } = await render()
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  const cpi = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  expect(policy, '政策会议必须自己一块牌').not.toBeNull()
  expect(cpi, 'CPI 不能因为挨着政策会议就被并掉').not.toBeNull()
  // 两块牌各写自己的名字，不是一块牌上两行日期。
  expect(policy.textContent).toContain('政策利率')
  expect(policy.textContent).not.toContain('CPI 年率')
  expect(cpi.textContent).toContain('CPI 年率')
  expect(cpi.textContent).not.toContain('政策利率')
  // 概率仍只在中央（牌上不重复表达同一个数）。
  expect(policy.textContent).not.toContain('89')
})

/**
 * 叠放（用户 2026-11）：**默认离现在近的那块在上**，层级由模型按日期排好，
 * 不靠 DOM 顺序碰运气；鼠标移到哪块、键盘聚焦到哪块，哪块就抬到最前并整块可读。
 */
it('stacks the nearer plaque above the farther one by default', async () => {
  const { host } = await render()
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  const cpi = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  const zOf = (node: HTMLElement): number => Number(node.style.getPropertyValue('--mi-clock-z'))
  // 12-09（18 天）比 12-10（19 天）近：它的层级更高。
  expect(zOf(policy)).toBeGreaterThan(zOf(cpi))
  // 层级不是靠 DOM 顺序：`--mi-clock-z` 真的写在牌上，样式表读这个变量。
  expect(zOf(cpi)).toBeGreaterThan(0)
})

it('raises the plaque under the pointer above every other plaque', async () => {
  const { host } = await render()
  const policy = host.querySelector<HTMLElement>('[data-clock-metric="US.TARGET_RATE.DECISION"]')!
  const cpi = host.querySelector<HTMLElement>('[data-clock-metric="US.CPI.NSA.YOY"][data-clock-plaque="future"]')!
  // 被压住的是 CPI（更远、层级更低）——它抬起来时必须是全卡最高的一块。
  expect(cpi.style.zIndex).toBe('')
  await act(async () => { cpi.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(cpi.style.zIndex).toBe(String(clockPlaqueRaisedZ))
  expect(clockPlaqueRaisedZ).toBeGreaterThan(clockPlaqueOverlayZ)
  expect(Number(cpi.style.zIndex)).toBeGreaterThan(Number(policy.style.getPropertyValue('--mi-clock-z')))
  // 移开就落回自己那一层，不留着一直压住别人。
  await act(async () => { cpi.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
  expect(cpi.style.zIndex).toBe('')
})

/**
 * 牌子是**假控件**的反面：它不点击、不展开，所以不许进 Tab 序列（进去了读屏会以为这里能操作，
 * 聚焦之后却什么都不发生）。抬起来只对鼠标，键盘/读屏靠的是「文字本来就在」。
 */
it('keeps the plaques out of the tab order, because nothing happens on them', async () => {
  const { host } = await render()
  for (const node of host.querySelectorAll<HTMLElement>('[data-clock-plaque]')) {
    expect(node.getAttribute('tabindex'), '牌子不许可聚焦').toBeNull()
    expect(node.getAttribute('role'), '牌子不许伪装成控件').toBeNull()
  }
})

/**
 * 叠住只是**视觉**问题：信息不能跟着被盖掉。每块牌的名字与天数都是真实文本，
 * 读屏按文档顺序读得到——包括被压在最下面那块，以及和它压在一起的那条时间。
 */
it('lets a screen reader read every plaque in full, including the covered one', async () => {
  const model = build({ today, metrics })
  const { host } = await render({ model })
  // 每块牌都要把自己的名字与天数交出来——不只是最上面那块；被盖住的 CPI 也一样。
  for (const plaque of model.plaques) {
    const node = host.querySelector<HTMLElement>(`[data-clock-metric="${plaque.metricKey}"][data-clock-plaque="${plaque.zone}"]`)!
    expect(node, `${plaque.metricKey} 必须画出来`).not.toBeNull()
    expect(node.textContent, `${plaque.metricKey} 的名字要能读到`).toContain(text.names[plaque.nameKey as keyof typeof text.names])
    const days = plaque.zone === 'future' ? plaque.daysUntil : plaque.daysAgo
    expect(node.textContent, `${plaque.metricKey} 的天数要能读到`).toContain(`${String(days)} 天`)
  }
  // 被盖住的那块没有被任何无障碍手段藏起来（藏了读屏就读不到），也没有另起一个可访问名把同一句读两遍。
  for (const node of host.querySelectorAll<HTMLElement>('[data-clock-plaque]')) {
    expect(node.getAttribute('aria-hidden'), '盖住是视觉的，不许连读屏一起藏').toBeNull()
    expect(node.hasAttribute('hidden')).toBe(false)
    expect(node.getAttribute('aria-label'), '文字本来就在，不再另起一个可访问名重复读一遍').toBeNull()
  }
})
