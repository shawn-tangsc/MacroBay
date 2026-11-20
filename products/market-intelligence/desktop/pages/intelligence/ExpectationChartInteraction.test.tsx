// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { estimateEventLabelWidth, ExpectationChart, fitEventLabel, type ExpectationChartText, type ExpectationPoint } from './ExpectationChart'

/**
 * 读数面板：鼠标跟着走、键盘左右移点、Esc 收起。
 *
 * 判据是能红的：面板里必须**同时**有 5 个概率和 1 个期望值，且期望值等于这 5 个概率按
 * `25×加25 + 50×加50+ − 25×降25 − 50×降50+` 手算出来的结果（一位小数舍入）。
 */

const text: ExpectationChartText = {
  aria: '利率数学期望曲线',
  outcomes: { 'no-change': '维持', 'hike-25': '加息 25', 'hike-50-plus': '加息 50+', 'cut-25': '降息 25', 'cut-50-plus': '降息 50+' },
  expectation: '加权期望',
  vsYesterday: '较上一日',
  flat: '持平',
  noHistory: '无历史可比'
}

const early: ExpectationPoint = {
  at: '2026-10-30T00:00:00.000Z',
  bp: 19.5,
  values: { 'no-change': 0.2, 'hike-25': 0.75, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
}
const late: ExpectationPoint = {
  at: '2026-11-12T23:00:00.000Z',
  bp: 21,
  values: { 'no-change': 0.1, 'hike-25': 0.8, 'hike-50-plus': 0.05, 'cut-25': 0.04, 'cut-50-plus': 0.01 }
}

let root: Root | undefined
let host: HTMLDivElement | undefined

/**
 * happy-dom 没有布局：`clientWidth` / `clientHeight` / `offsetHeight` 恒为 0。
 * 面板现在只认**量到的**盒子，量不到就不显示——所以单测必须先把这些尺寸喂进去，
 * 否则每条读数用例都会「面板不出现」，而那不是被测行为。
 */
function stubBox(width: number, height: number, tipHeight = 152): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => tipHeight })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
  for (const key of ['clientWidth', 'clientHeight', 'offsetHeight']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
  }
})

async function render(
  latest?: Readonly<{ changeBp?: number }>,
  height = 240,
  width = 480,
  stageBox?: Readonly<{ width: number; height: number }>
): Promise<HTMLDivElement> {
  stubBox(stageBox?.width ?? width, stageBox?.height ?? height)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <ExpectationChart points={[early, late]} events={[]} height={height} width={width} text={text} {...(latest ? { latest } : {})} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  return host.querySelector('.mk-plot__stage') as HTMLDivElement
}

const tip = (): HTMLElement => document.body.querySelector('.mk-tip') as HTMLElement
const rows = (): HTMLElement[] => Array.from(document.body.querySelectorAll('.mk-tip__mix dt'))

async function move(stage: HTMLElement, clientX: number, clientY = 60): Promise<void> {
  await act(async () => {
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }))
  })
}

async function press(stage: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    stage.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
  })
}

describe('sizing', () => {
  it('draws at exactly the width it was given — no floor, no scroll container', async () => {
    const stage = await render(undefined, 240, 320)
    const svg = stage.querySelector('svg')!
    // 把 380 那个地板加回来，这里就是 380，比容器宽 → 出横条。这条守卫就是用来红的。
    expect(svg.getAttribute('width')).toBe('320')
    expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(320)
    // 滚动容器本身是横条的来源，已经拆掉。
    expect(stage.querySelector('.mk-plot__scroll')).toBeNull()
  })

  it('keeps the last date label inside the plot, right-aligned', async () => {
    const stage = await render(undefined, 240, 320)
    const svg = stage.querySelector('svg')!
    const dates = Array.from(svg.querySelectorAll('text')).filter((node) => node.getAttribute('y') === '222')
    expect(dates.length).toBeGreaterThan(1)
    const last = dates[dates.length - 1]!
    expect(last.getAttribute('text-anchor')).toBe('end')
    // 右边界就是 W - RM（320 - 12），向右对齐后文字不会出界。
    expect(Number(last.getAttribute('x'))).toBeCloseTo(308, 5)
  })
})

describe('zero axis', () => {
  it('carries no sentence of its own — the tick label is the only thing on that line', async () => {
    const stage = await render()
    const svg = stage.querySelector('svg')!
    // 数据全正：零轴就是绘图区底边（`height - 34`）。这里不许出现任何说明文字；
    // 左侧的 `0bp` 刻度标签在 x = L - 8（绘图区之外），不在此列。
    const zeroY = 240 - 34
    const nearZero = Array.from(svg.querySelectorAll('text')).filter((node) => {
      const y = Number(node.getAttribute('y') ?? 'NaN')
      const x = Number(node.getAttribute('x') ?? 'NaN')
      return Number.isFinite(y) && Number.isFinite(x) && Math.abs(y - zeroY) <= 8 && x > 52
    })
    expect(nearZero.map((node) => node.textContent)).toEqual([])
  })
})

describe('expectation readout panel', () => {
  it('shows five probabilities and the expectation computed from them', async () => {
    const stage = await render()
    await move(stage, 1000)
    expect(tip().dataset.active).toBe('true')
    expect(rows()).toHaveLength(5)
    expect(rows().map((row) => row.textContent)).toEqual(['加息 25', '加息 50+', '维持', '降息 25', '降息 50+'])
    const shares = Array.from(document.body.querySelectorAll('.mk-tip__mix dd')).map((cell) => cell.textContent)
    expect(shares).toEqual(['80.0%', '5.0%', '10.0%', '4.0%', '1.0%'])
    // 手算末点：25×0.8 + 50×0.05 − 25×0.04 − 50×0.01 = 20 + 2.5 − 1 − 0.5 = 21.0bp
    expect(document.body.querySelector('.mk-tip__sum b')?.textContent).toBe('+21.0bp')
  })

  it('gives the earliest point when the cursor is at the left edge — the values follow the point', async () => {
    const stage = await render()
    await move(stage, 0)
    // 手算首点：25×0.75 + 50×0.03 − 25×0.01 − 50×0.01 = 18.75 + 1.5 − 0.25 − 0.5 = 19.5bp
    expect(document.body.querySelector('.mk-tip__sum b')?.textContent).toBe('+19.5bp')
    expect(rows()).toHaveLength(5)
  })

  it('adds the day-over-day line only on the last point', async () => {
    const stage = await render({ changeBp: 0.4 })
    await move(stage, 1000)
    expect(document.body.querySelector('.mk-tip__delta')?.textContent).toBe('较上一日+0.4bp')
    await move(stage, 0)
    expect(document.body.querySelector('.mk-tip__delta')).toBeNull()
  })

  it('says there is no earlier reading instead of +0.0bp', async () => {
    const stage = await render({})
    await move(stage, 1000)
    expect(document.body.querySelector('.mk-tip__delta b')?.textContent).toBe('无历史可比')
  })

  it('follows the cursor: same point, the panel still moves with the mouse', async () => {
    // 高一点的图：面板在矮图里会被下边界夹住，那是边界规则，不是「没跟随」。
    const stage = await render(undefined, 600)
    const translateOf = () => {
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(tip().style.transform)
      return { x: Number(match?.[1] ?? 'NaN'), y: Number(match?.[2] ?? 'NaN') }
    }
    // 两个位置都离首点更近：点不变、面板位置必须变，否则就不是「跟随」而是钉住。
    await move(stage, 20, 100)
    const first = translateOf()
    await move(stage, 60, 150)
    const second = translateOf()
    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('keeps the panel off the cursor and inside the stage', async () => {
    const stage = await render()
    // 右边缘 hover：面板必须往左翻，不越出绘图区。
    await move(stage, 470, 8)
    const left = Number(/translate\(([-\d.]+)px/.exec(tip().style.transform)?.[1] ?? 'NaN')
    expect(left).toBeLessThan(470)
    expect(left).toBeGreaterThanOrEqual(4)
    // 面板与光标之间必须留出空隙：光标 470 不在 [left, left+width] 里。
    expect(left + tip().offsetWidth).toBeLessThanOrEqual(470)
  })

  it('never shows the panel before the stage box has been measured', async () => {
    // 舞台量到 0×0（首帧、或 ref 还没挂上）：不许拿 prop 尺寸兜底把面板画到错的位置。
    const stage = await render(undefined, 240, 480, { width: 0, height: 0 })
    await move(stage, 240, 100)
    expect(tip().dataset.active).toBe('false')
  })

  it('narrows instead of covering the cursor when the plot is 300px wide', async () => {
    const stage = await render(undefined, 240, 300)
    await move(stage, 150, 100)
    const panel = tip()
    expect(panel.style.width).toBe('132px')
    const left = Number(/translate\(([-\d.]+)px/.exec(panel.style.transform)?.[1] ?? 'NaN')
    // 收窄后仍整块在图内（左右各留 4px），且不压住光标那一点。
    expect(left).toBeGreaterThanOrEqual(4)
    expect(left + 132).toBeLessThanOrEqual(300 - 4)
    // 内容不增不减：五档一行不少。
    expect(rows()).toHaveLength(5)
    expect(document.body.querySelector('.mk-tip__sum')).not.toBeNull()
  })

  it('works from the keyboard: focus, arrows move the point, Esc closes', async () => {
    const stage = await render()
    expect(stage.getAttribute('tabindex')).toBe('0')
    await press(stage, 'ArrowRight')
    expect(tip().dataset.active).toBe('true')
    const first = document.body.querySelector('.mk-tip__sum b')?.textContent
    await press(stage, 'ArrowRight')
    const second = document.body.querySelector('.mk-tip__sum b')?.textContent
    expect(second).not.toBe(first)
    await press(stage, 'Escape')
    expect(tip().dataset.active).toBe('false')
  })
})

describe('event labels on the chart', () => {
  it('establishes width by character class, not by a single per-character number', () => {
    // 汉字按 9.5px、西文半角按 5.2px：只按 5.2 估，一条中文标题会少算一半。
    expect(estimateEventLabelWidth('CPI 年率')).toBeCloseTo(5.2 * 3 + 5.2 + 9.5 + 9.5, 5)
    expect(estimateEventLabelWidth('上周EIA天然气库存变化(亿立方英尺)(至1030)'))
      .toBeGreaterThan('上周EIA天然气库存变化(亿立方英尺)(至1030)'.length * 6)
  })

  it('truncates a long title with an ellipsis and never exceeds the cap', () => {
    const long = '上周EIA天然气库存变化(亿立方英尺)(至1030)'.repeat(2)
    const fitted = fitEventLabel(`↓ −0.9bp ${long}`)
    expect(fitted.endsWith('…')).toBe(true)
    expect(estimateEventLabelWidth(fitted)).toBeLessThanOrEqual(160)
  })

  it('keeps the drawn label inside the plot even for a 40-character title', async () => {
    const stage = await render()
    const long = '上周EIA天然气库存变化(亿立方英尺)(至1030)'.repeat(2)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <ExpectationChart points={[early, late]} events={[{ at: '2026-11-05T00:00:00.000Z', label: long, changeBp: -0.9, bp: 20 }]}
          height={240} width={480} text={text} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    const svg = stage.ownerDocument.querySelector('.mk-plot__svg')!
    const label = Array.from(svg.querySelectorAll('text')).find((node) => (node.textContent ?? '').includes('…'))
    expect(label).toBeDefined()
    const x = Number(label!.getAttribute('x'))
    expect(x + estimateEventLabelWidth(label!.textContent ?? '')).toBeLessThanOrEqual(480)
    // 图不许比格子宽：<svg width> 必须就是量到的盒子宽度。
    expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(480)
  })
})
