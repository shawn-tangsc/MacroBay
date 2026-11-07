// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { PositioningPanel } from './PositioningPanel'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/positioning/PositioningPanel.css'), 'utf8')

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

// Four 8-hour points: the state read compares the newest with the one three points back.
const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? 0.0062 : 0.0121, paymentDirection: 'long-pays-short' as const })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? -0.0031 : 0.0002, paymentDirection: 'short-pays-long' as const }))
}

const positioning: DashboardPositioningViewState = {
  state: 'available',
  window: '7d',
  btc: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 8.9e9 - index * 1e7 })),
  eth: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 2.4e9 + index * 1e7 })),
  changeBtc: { h1Pct: -0.4, h24Pct: -6.5 },
  changeEth: { h1Pct: 0.2, h24Pct: 2.7 },
  signal: { state: 'hidden' },
  // 与钩子里的卡片状态同型：`onReload` 是每张卡都有的重读入口，不是某个状态的专属字段。
  onReload: () => undefined
}

/** 需要改动「一半字段」的用例从这里展开：展开一个联合类型会丢掉 `state` 的判别力。 */
const availablePositioning = positioning as Extract<DashboardPositioningViewState, { state: 'available' }>

const render = (props: Partial<Parameters<typeof PositioningPanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
    funding, positioning, window: '7d', onWindowChange: () => undefined, text, ...props
  }) }))

afterEach(() => { document.body.innerHTML = '' })


/** A card whose rule fired: the chip exists only then, and the chip is the entry to the dialog. */
const alertPositioning: DashboardPositioningViewState = {
  ...positioning,
  signal: { state: 'alert', asset: 'btc', direction: 'long', dropPct: -1.9, volumeMultiple: 3.4, observedAt: at(15) }
}

/** Mounts the card. The dialog portals to `<body>`, so assertions about it read there. */
async function mountPanel(renderProps: Partial<Parameters<typeof PositioningPanel>[0]> = {}): Promise<{ host: HTMLElement; entry: HTMLButtonElement }> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
      funding, positioning, window: '7d', onWindowChange: () => undefined, text, ...renderProps
    }) }))
  })
  return { host, entry: host.querySelector<HTMLButtonElement>('.mi-positioning-panel__signal')! }
}

/** antd mounts a portal panel after `open` flips; these flushes run its effects and close timers. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

async function settleClose(): Promise<void> {
  // 关闭走 antd 的离场动画：happy-dom 不会自己发 transitionend/animationend，于是 afterClose
  // （卸载内容、把焦点送回入口）永远不来。这里补那一个浏览器事件，而不是替 antd 实现关闭。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  for (const node of document.querySelectorAll<HTMLElement>('.ant-modal, .ant-modal-wrap')) {
    await act(async () => {
      node.dispatchEvent(new Event('animationend', { bubbles: true }))
      node.dispatchEvent(new Event('transitionend', { bubbles: true }))
    })
  }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
}

async function openReadings(): Promise<{ host: HTMLElement; entry: HTMLButtonElement }> {
  const mounted = await mountPanel({ positioning: alertPositioning })
  // 先聚焦再点开：antd 记下的是「打开前聚焦的元素」。浏览器点按钮本身就会聚焦，happy-dom 不会。
  mounted.entry.focus()
  await act(async () => { mounted.entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
  return mounted
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

describe('positioning panel', () => {
  it('prints the funding rate and the notional reading side by side, one asset per row', () => {
    const markup = render()
    expect(markup).toContain(text.pairTitle)
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain(text.paymentDirections['long-pays-short'])
    expect(markup).toContain(text.notional)
    expect(markup).toMatch(/\$8\.8\dB/)
    expect(markup).toContain(text.states.deleveraging)
  })

  it('draws the notional line and the funding bars on one time axis', () => {
    const markup = render()
    expect(markup).toContain('data-series="btc"')
    expect(markup).toContain('data-series="eth"')
    expect(markup).toContain('mi-positioning-panel__bar')
    expect(markup).toContain('mi-positioning-panel__line')
  })

  it('names the window it is showing and switches through the callback', () => {
    const markup = render()
    // One group, one Tab stop, and the chosen window carries aria-pressed rather than only a colour.
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('7 天')
    const onWindowChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => { root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
      funding, positioning, window: '7d', onWindowChange, text
    }) })) })
    const options = [...container.querySelectorAll('[role="group"] button')] as HTMLButtonElement[]
    expect(options).toHaveLength(2)
    act(() => { options[1]!.click() })
    expect(onWindowChange).toHaveBeenCalledWith('24h')
    act(() => root.unmount())
  })

  it('marks the bucket the rule reported and names it once, on the chip', () => {
    const markup = render({
      positioning: {
        ...availablePositioning,
        signal: { state: 'alert', asset: 'btc', direction: 'long', dropPct: -1.9, volumeMultiple: 3.4, observedAt: at(0) }
      }
    })
    // One mark, pinned to the signal's own bucket, and one chip naming it.
    expect(markup).toContain('data-signal-mark')
    expect(markup).toContain('疑似多头爆仓 BTC -1.9% · 量 3.4×')
    // The query's own hint list is no longer drawn: one reading, one mark, one sentence.
    expect(markup).not.toContain('data-hint-list')
  })


  it('keeps the funding half when the positioning half is missing, and marks which half failed', () => {
    const markup = render({ positioning: { state: 'empty', onReload: () => undefined } })
    expect(markup).toContain('data-state="empty"')
    // An empty card is a state, and the shared StateView owns its sentence and shape now.
    expect(markup).toContain('class="state-view')
    expect(markup).toContain('data-state="empty"')
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain('—')
  })

  it('tells a failed read from an empty one', () => {
    // Nothing collected is `empty`; a read that could not answer is `error`. Mixing them is how
    // "we have nothing" and "we could not look" start reading alike.
    expect(render({ positioning: { state: 'unavailable', onReload: () => undefined } })).toContain('data-state="error"')
    expect(render({ positioning: { state: 'empty', onReload: () => undefined } })).toMatch(/class="state-view[^"]*"[^>]*data-state="empty"/)
  })

  it('shows the loading state through the shared component', () => {
    const markup = render({ positioning: { state: 'loading' } })
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('class="mi-positioning-panel__chart"')
  })

  it('waits without drawing a failure or an empty card before the first read returns', () => {
    // First paint: neither half has answered. Waiting is its own state — "could not read" and
    // "nothing collected" are both claims about a read that has not happened yet.
    const markup = render({ positioning: { state: 'loading' }, funding: { state: 'loading' } })
    expect(markup).toContain('data-state="loading"')
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('class="state-view')
    expect(markup).not.toContain('data-state="error"')
    expect(markup).not.toContain(text.empty)
  })

  it('flags a stale reading without dropping it', () => {
    const markup = render({ positioning: { ...availablePositioning, staleSince: at(120) } })
    expect(markup).toContain('data-stale="true"')
    expect(markup).toContain(text.stale)
    expect(markup).toMatch(/\$8\.8\dB/)
  })

  it('keeps every class it renders in its own stylesheet', () => {
    const classes = new Set([...render().matchAll(/class="([^"]+)"/g)].flatMap(match => match[1]!.split(/\s+/)))
    for (const name of classes) {
      if (!name.startsWith('mi-positioning-panel')) continue
      expect(styles, name).toContain(`.${name}`)
    }
  })
})

describe('funding bars per settlement period', () => {
  it('draws one bar per asset per 8-hour period even when the two settle seconds apart', () => {
    // Binance settles each symbol on its own clock; a timestamp-keyed bar drew both plus the
    // overlap, which read as three bars in one band.
    const skewed: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [{ observedAt: '2026-10-28T23:59:58.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' }],
      eth: [{ observedAt: '2026-10-29T00:00:02.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    const markup = render({ funding: skewed })
    const bars = [...markup.matchAll(/<rect[^>]*mi-positioning-panel__bar[^>]*>/g)]
    expect(bars).toHaveLength(2)
    // Both bars belong to the same period; flooring put one of them a day later.
    const periods = new Set(bars.map(bar => /data-settles-at="([^"]+)"/.exec(bar[0])?.[1]))
    expect([...periods]).toEqual(['2026-10-29T00:00:00.000Z'])
  })

  it('still draws one bar when a symbol reports twice inside the same period', () => {
    const duplicate: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [
        { observedAt: '2026-10-28T23:59:58.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' },
        { observedAt: '2026-10-29T00:00:02.000Z', ratePercent: 0.0071, paymentDirection: 'long-pays-short' }
      ],
      eth: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    expect([...render({ funding: duplicate }).matchAll(/class="mi-positioning-panel__bar"/g)].length).toBe(2)
  })
})

describe('hover readout', () => {
  it('names both series for both assets, so the pointer answers four numbers, not three', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
        funding, positioning, window: '7d', onWindowChange: () => undefined, text
      }) }))
    })
    // The help trigger is an SVG icon too; pick the chart, not the glyph.
    const svg = container.querySelector('.mi-positioning-panel__chart svg')!
    act(() => {
      svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 40 }))
    })
    const tooltip = container.querySelector('.mi-positioning-panel__tooltip')!
    expect(tooltip.textContent).toContain(text.assets.btc)
    expect(tooltip.textContent).toContain(text.assets.eth)
    expect(tooltip.textContent).toContain(text.oiShort)
    expect(tooltip.textContent).toContain(text.rateShort)
    // Two assets, each with two readings.
    expect(tooltip.querySelectorAll('span[data-series]')).toHaveLength(2)
    act(() => root.unmount())
  })
})

describe('bars at the axis edge', () => {
  it('keeps the newest pair apart instead of clamping both onto the same x', () => {
    // The last period settles at the window end, so both bars wanted to sit on the right edge.
    const edge: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' }],
      eth: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    const markup = render({ funding: edge })
    const xs = [...markup.matchAll(/<rect[^>]*mi-positioning-panel__bar[^>]*>/g)]
      .map(match => Number(/ x="([\d.]+)"/.exec(match[0])?.[1]))
    expect(xs).toHaveLength(2)
    expect(Math.abs(xs[0]! - xs[1]!)).toBeGreaterThan(1)
  })
})

describe('combined readout', () => {
  it('shows the state, and the two numbers behind it on its own line', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
        funding, positioning, window: '7d', onWindowChange: () => undefined, text
      }) }))
    })
    expect(container.textContent).toContain(text.states.deleveraging)
    // The "why" line is a one-line tooltip: the numbers appear only once the reader asks for them.
    const trigger = container.querySelector('.mi-positioning-panel__state')!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    // The platform tooltip waits 0.3s before it appears, so the assertion waits with it.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    expect(document.body.textContent).toContain('+0.0121%')
  })
})

describe('the liquidation note: three states, one line, never two', () => {
  const noteOf = (positioningState: DashboardPositioningViewState) => {
    const markup = render({ positioning: positioningState })
    const line = markup.match(/<p class="mi-positioning-panel__liquidation-note"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
    return { markup, line, count: markup.split('data-liquidation-note').length - 1 }
  }
  const hidden = { ...availablePositioning, signal: { state: 'hidden' as const } }
  const unreadable = { ...availablePositioning, signal: { state: 'unreadable' as const, failureCode: 'query-failed' as const, onReload: () => undefined } }
  const insufficient = { ...availablePositioning, signal: { state: 'insufficient' as const } }

  it('says nothing was hit when the rule ran and found nothing', () => {
    const { line, count } = noteOf(hidden)
    expect(count).toBe(1)
    expect(line).toContain(text.liquidationNoteNoHit)
    // 窗口必须是 24 小时：判定窗口不随页签变，写成 7 天，切到 7 天视图这句话就是假话。
    expect(text.liquidationNoteNoHit).toContain('近 24 小时')
    expect(text.liquidationNoteNoHit).not.toContain('7 天')
  })

  it('says the rule could not be read, and only that', () => {
    const { line, count } = noteOf(unreadable)
    expect(count).toBe(1)
    expect(line).toContain(text.liquidationNoteUnreadable)
    expect(line).not.toContain(text.liquidationNoteNoHit)
    expect(line).not.toContain(text.liquidationNoteInsufficient)
  })

  it('says the data is not enough, and only that', () => {
    const { line, count } = noteOf(insufficient)
    expect(count).toBe(1)
    expect(line).toContain(text.liquidationNoteInsufficient)
    expect(line).not.toContain(text.liquidationNoteNoHit)
    expect(line).not.toContain(text.liquidationNoteUnreadable)
  })

  it('never speaks on a card that is empty, failed or still loading', () => {
    // 那是平台 `StateView` 的地盘：同一件事不许有两个出处，也不许两句话一起上屏。
    for (const state of [
      { state: 'empty' as const, onReload: () => undefined },
      { state: 'unavailable' as const, onReload: () => undefined },
      { state: 'loading' as const }
    ]) {
      expect(noteOf(state).count).toBe(0)
    }
  })

  it('keeps the note a footnote: muted, one line, no icon, no alert tone', () => {
    const { line } = noteOf(insufficient)
    // 脚注语气：没有图标、没有告警色标记，只有一句话。
    expect(line).not.toContain('<svg')
    expect(line).not.toContain('data-tone')
    expect(styles).toMatch(/\.mi-positioning-panel__liquidation-note \{[^}]*color: var\(--mi-dashboard-muted\)/)
  })
})

describe('the chip is the entry to the dialog', () => {
  it('opens from the chip, and the chip says so three ways', async () => {
    const { host, entry } = await mountPanel({ positioning: alertPositioning })
    // 牌子上就是读数，不是第二颗按钮：`aria-haspopup` 说清点开是对话框；没有 `aria-expanded`，
    // 因为这不是就地展开。
    expect(entry.tagName).toBe('BUTTON')
    expect(entry.getAttribute('aria-haspopup')).toBe('dialog')
    expect(entry.hasAttribute('aria-expanded')).toBe(false)
    // 可见文字在前（label-in-name），后面才说点开会怎样。
    const label = entry.getAttribute('aria-label')!
    expect(label.startsWith('疑似多头爆仓')).toBe(true)
    expect(label).toContain(text.helpDetailsLabel)
    // 常驻 6×6 的 ›：只表示「点开有东西」。
    const chevron = entry.querySelector('.mi-positioning-panel__signal-chevron')
    expect(chevron).not.toBeNull()
    expect(chevron!.getAttribute('width')).toBe('6')
    expect(chevron!.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()

    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    const surface = dialog()
    expect(surface).not.toBeNull()
    // 三组都在：这次读数、这张卡在读什么、口径上容易读错的地方。
    expect(document.querySelector('#mi-positioning-signal-detail')?.getAttribute('aria-label')).toBe(text.signalDetailsTitle)
    expect(surface!.textContent).toContain(text.signalDetailsRuleName)
    expect(surface!.textContent).toContain(text.helpBullets[0])
    expect(surface!.textContent).toContain('六档判定')
    expect(surface!.textContent).toContain('只标 15 分钟内的骤降')
    expect(surface!.textContent).toContain('相对过去 24 小时同长度桶均量的倍数')
    // 弹层归 portal：卡里始终没有那块常驻区域。
    expect(host.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
  })

  it('shows the explanation when the chip is focused, and opening the dialog takes it away', async () => {
    const { entry } = await mountPanel({ positioning: alertPositioning })
    await act(async () => { entry.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    // 平台 Tooltip：聚焦立即出现（悬停才等 0.3s）。
    await flush()
    const bubbles = [...document.querySelectorAll<HTMLElement>('.ant-tooltip')]
    expect(bubbles.length).toBeGreaterThan(0)
    expect(bubbles.at(-1)!.textContent).toContain(`${text.signalDetailsRuleName}｜窗口 ${text.window15m}｜${text.signalKindInferred}`)

    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(dialog()).not.toBeNull()
    // 气泡挂在 `<body>` 下、层级比弹窗高，所以弹层开着时由一条 CSS 让它让位（牌子不重建，
    // 焦点回位仍归 antd）。界面设计 v2 §二：打开瞬间气泡不在 dialog 之上。
    expect(styles).toContain('body:has(.mi-positioning-panel__help-dialog) .ant-tooltip { display: none; }')
  })

  it('lets the click through the explanation and opens the dialog', async () => {
    // 「说明不吞点击」：气泡在下、点在牌子上；按下时说明先收起，再开弹层。
    const { entry } = await mountPanel({ positioning: alertPositioning })
    await act(async () => {
      entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      entry.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    expect(document.querySelectorAll('.ant-tooltip').length).toBeGreaterThan(0)

    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(dialog()).not.toBeNull()
  })

  it('closes with its own close control and gives focus back to the chip', async () => {
    await openReadings()
    const close = document.querySelector<HTMLButtonElement>('.ant-modal-close')
    expect(close).not.toBeNull()
    await act(async () => { close!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settleClose()
    expect(document.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
    expect((document.activeElement as HTMLElement | null)?.className).toContain('mi-positioning-panel__signal')
  })

  it('closes on Escape and gives focus back to the chip', async () => {
    await openReadings()
    // rc-dialog 判的是 `keyCode`，且监听落在弹层上（与平台 Modal 的用例同一条路径）。
    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')!
    await act(async () => {
      wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true } as never))
      wrap.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true } as never))
    })
    await settleClose()
    expect(document.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
    expect((document.activeElement as HTMLElement | null)?.className).toContain('mi-positioning-panel__signal')
  })

  it('closes when the reader clicks the backdrop', async () => {
    const { host } = await openReadings()
    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')
    expect(wrap).not.toBeNull()
    await act(async () => { wrap!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settleClose()
    expect(document.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
    expect(host.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
  })

  it('renders no entry at all on a card with no signal', async () => {
    // 没有读数就没有可解释的口径：连入口一起不渲染（不是禁用，也不是灰的）。
    const { host } = await mountPanel()
    expect(host.querySelector('[aria-haspopup="dialog"]')).toBeNull()
    expect(host.textContent).not.toContain(text.helpDetailsLabel)
    expect(host.querySelector('.mi-positioning-panel__help-dialog')).toBeNull()
    const markup = render()
    expect(markup).not.toContain('mi-positioning-panel__help-dialog')
    expect(markup).not.toContain(text.helpDetailsLabel)
  })

  it('still keeps the four bullets short enough to be a glance', () => {
    // The count and the length are the design's acceptance line; a fifth bullet or a long one means
    // the sentence belongs in the readings below them, not in the lead.
    expect(text.helpBullets).toHaveLength(4)
    for (const bullet of text.helpBullets) expect(bullet.length).toBeLessThanOrEqual(60)
  })
})

describe('time axis', () => {
  it('labels five instants across the window so a dip can be placed in time', () => {
    const markup = render()
    const ticks = [...markup.matchAll(/class="mi-positioning-panel__tick">([^<]*)</g)].map(match => match[1])
    expect(ticks).toHaveLength(5)
    expect(ticks[0]).not.toBe(ticks.at(-1))
  })
})

describe('line-end readings', () => {
  it('labels the last point of each line so the curve can be matched to the summary', () => {
    const markup = render()
    const ends = [...markup.matchAll(/data-line-end="(\w+)"[^>]*>([^<]*)</g)]
    expect(ends).toHaveLength(2)
    expect(ends.map(match => match[1]).sort()).toEqual(['btc', 'eth'])
    for (const [, , label] of ends) expect(label).toMatch(/^\$[\d.]+[BM]$/)
  })

  it('says in the help that the two lines are scaled to their own ranges', () => {
    expect(text.helpBullets.some(line => line.includes('不能直接比'))).toBe(true)
  })
})

describe('what the mark does not cover', () => {
  it('says that only a 15-minute collapse is marked, not a slow decline', () => {
    expect(text.helpDetails.some(line => line.includes('只标 15 分钟内的骤降'))).toBe(true)
  })
})

describe('the liquidation multiple', () => {
  it('names what the multiple measures, in the readings the reader can open', async () => {
    // A bare "3.4×" said nothing about what was multiplied; the sentence lives in the readings.
    await openReadings()
    expect(document.body.textContent).toContain('相对过去 24 小时同长度桶均量的倍数')
  })
})

describe('the module rule chip', () => {
  const alert = (overrides: Record<string, unknown> = {}): DashboardPositioningViewState => ({
    state: 'available' as const,
    window: '7d' as const,
    onReload: () => undefined,
    btc: positioning.state === 'available' ? positioning.btc : [],
    eth: positioning.state === 'available' ? positioning.eth : [],
    signal: { state: 'alert' as const, asset: 'btc' as const, direction: 'long' as const, dropPct: -1.9, volumeMultiple: 3.4, observedAt: at(15) },
    ...overrides
  })

  it('names the side that was liquidated, and puts the sign in the sentence', () => {
    const markup = render({ positioning: alert({ signal: { state: 'alert' as const, asset: 'btc' as const, direction: 'short' as const, dropPct: -2.4, pricePct: 1.8, volumeMultiple: 3.1, observedAt: at(15) } }) })
    // 方向进词、符号进数：空头被清要写「涨」，不能拿「强平」把两头混成一句。
    expect(markup).toContain('疑似空头爆仓 BTC +1.8%')
    expect(markup).not.toContain('疑似强平')
  })

  it('draws the rule\'s own words and numbers when it fires', () => {
    const markup = render({ positioning: alert() })
    expect(markup).toContain('疑似多头爆仓')
    expect(markup).toContain('-1.9%')
    expect(markup).toContain('3.4×')
    // Severity never reaches the reader.
    expect(markup).not.toContain('严重')
    expect(markup).not.toContain('high')
  })

  it('renders nothing at all on a normal market, not an empty container', () => {
    const markup = render({ positioning: alert({ signal: { state: 'hidden' } }) })
    expect(markup).not.toContain('mi-positioning-panel__signal')
  })

  it('says data is insufficient without a digit or a direction', () => {
    const markup = render({ positioning: alert({ signal: { state: 'insufficient' } }) })
    expect(markup).toContain('数据不齐')
    const chip = markup.slice(markup.indexOf('mi-positioning-panel__signal'))
    const chipText = chip.slice(0, chip.indexOf('</span>'))
    expect(chipText).not.toMatch(/\d/)
    expect(chipText).not.toContain('强平')
  })

  it('keeps the rule, the window and the inference out of a title attribute', () => {
    // A `title` carries a sentence to neither the keyboard nor the touch reader. The same facts
    // live behind the chip's own expansion, where the reader can actually reach them.
    const markup = render({ positioning: alert() })
    expect(markup).not.toContain('title="')
    expect(markup).not.toContain('oi-liquidation-proxy')
  })
})

describe('opening the reading', () => {
  it('opens the numbers in a dialog, and opening them spends nothing', async () => {
    const invoke = vi.fn(async () => { throw new Error('the panel must not reach the bridge') })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const { entry } = await mountPanel({ positioning: alertPositioning })
    // A native button: Tab reaches it and Enter/Space activate it, no key handler to invent.
    const chipNode = entry
    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    // 牌子不重建：`entry` 还是同一个节点，antd 的焦点回位才落得回它身上。
    expect(document.querySelector('.mi-positioning-panel__signal')).toBe(chipNode)
    expect(dialog()?.textContent).toContain(text.helpDetailsLabel)
    const detail = document.querySelector('#mi-positioning-signal-detail')!
    // The rule is named in the reader's words. The internal id is not a reading and never shows.
    expect(detail.textContent).toContain(text.signalDetailsRuleName)
    expect(detail.textContent).not.toContain('oi-liquidation-proxy')
    expect(detail.textContent).toContain('-1.9%')
    expect(detail.textContent).toContain('3.4×')
    // Opening the numbers is free: nothing reaches the bridge, so no analysis or budget is spent.
    expect(invoke).not.toHaveBeenCalled()
    delete (window as unknown as { platform?: unknown }).platform
  })
})
