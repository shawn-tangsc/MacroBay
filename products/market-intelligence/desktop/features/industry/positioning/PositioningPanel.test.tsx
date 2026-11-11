// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStateViewText } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { PositioningPanel } from './PositioningPanel'
import { positioningNoteKeys, resolvePositioningNote } from './positioningNotes'
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
  hints: [],
  hiddenHits: 0,
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

/**
 * 每张卡挂过的 root 都要卸掉：`document.body.innerHTML = ''` 只清 DOM，不卸 React 树，
 * 而平台 `Popover` 的 Esc 监听挂在 `document` 上——留着，下一条用例的 Esc 会被它先吃掉。
 */
const mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => { root.unmount() })
  document.body.innerHTML = ''
})


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
  mountedRoots.push(root)
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

/**
 * 界面设计 2026-11-10（口径已定）：`观测时间 01:00 · 最新读数 01:45`，**只在两者不同时**出现第二段；
 * 24 小时 / 1 小时窗口下两点相同，只留「观测时间」。不用括号（那是"补充/次要"），也不加第三套词。
 */
it('adds 最新读数 only when it differs from the folded point', () => {
  const fmt = (instant: string) => formatShellInstant(instant, { timeZone: 'UTC', locale: 'zh-CN' })
  const sevenDay = render({ positioning: { ...availablePositioning, pointAt: at(60), newestReadingAt: at(15) } })
  expect(sevenDay).toContain(`${text.observedAt} ${fmt(at(60))}`)
  expect(sevenDay).toContain(` · ${text.newestReading} ${fmt(at(15))}`)
  // 不用括号，也不许冒出第三个词。
  const asOfLine = /<small class="mi-positioning-panel__asof">([\s\S]*?)<\/small>/u.exec(sevenDay)?.[1] ?? ''
  expect(asOfLine).not.toContain('（')
  expect(asOfLine).toContain(` · ${text.newestReading} `)
  expect(sevenDay).not.toContain('曲线末点')

  // 两个时刻相同（24h / 1h 窗口，或老载荷）：一个字都不多。
  const same = render({ positioning: { ...availablePositioning, pointAt: at(15), newestReadingAt: at(15) } })
  expect(same).toContain(`${text.observedAt} ${fmt(at(15))}`)
  expect(same).not.toContain(text.newestReading)
})

describe('positioning panel', () => {
  it('keeps the leg that has funding history and names the other as unknown with its reason', () => {
    const partial: DashboardFundingRateHistoryState = {
      state: 'partial',
      btc: funding.state === 'available' ? funding.btc : [],
      missing: { eth: 'value-invalid' }
    }
    const markup = render({ funding: partial })
    // The leg with values keeps its newest rate and its chart; the other says why it has none.
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain(text.fundingMissingLeg
      .replace('{asset}', text.assets.eth)
      .replace('{reason}', text.fundingMissingReasons['value-invalid']))
    // The whole card did not become an error state.
    expect(markup).not.toContain('data-state="unavailable"')
  })

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

  it('draws every hit in the window, not only the newest one', () => {
    // 7 天视图画 7 天内的全部命中；只看最新的那条会让旧命中凭空消失。
    const markup = render({
      positioning: {
        ...availablePositioning,
        hints: [
          { asset: 'btc', direction: 'long', observedAt: at(120), notionalUsd: 8.5e9, dropPct: -2.2, volumeMultiple: 5.1 },
          { asset: 'eth', direction: 'short', observedAt: at(30), notionalUsd: 2.4e9, dropPct: -1.9, volumeMultiple: 3.4 }
        ]
      }
    })
    expect(markup.split('data-hint="').length - 1).toBe(2)
    expect(markup).toContain('data-hint="btc"')
    expect(markup).toContain('data-hint="eth"')
  })


  it('keeps the card frame when nothing has been collected yet', () => {
    const markup = render({ positioning: { state: 'empty', onReload: () => undefined } })
    // 骨架还在：两行资产位与图表框都在，不是一块空状态。
    expect(markup).toContain('data-asset="btc"')
    expect(markup).toContain('data-asset="eth"')
    expect(markup).toContain('data-chart-skeleton="true"')
    expect(markup).toContain(text.empty)
    // 另一格（费率）照常给数：没有数据的是持仓那一半。
    expect(markup).toContain('+0.0062%')
    expect(markup).not.toContain('class="state-view')
  })

  it('offers no retry when the shape cannot be read, and says what actually works', () => {
    // 形状/版本不符：点了必然再失败。卡片不给假出路，改说读者唯一能做的动作。
    const mismatch = render({ positioning: { state: 'unavailable', cause: 'contract-mismatch', onReload: () => undefined } })
    expect(mismatch).toContain(text.contractMismatch)
    // 动作是「重启应用」而不是「再试一次」：版本不符重试多少次都一样。
    expect(mismatch).toContain(resolveStateViewText('zh-CN', STATE_VIEW_ACTION_KEYS.restart_app))
    expect(mismatch).not.toContain(text.actionRetry)
    // 「这次没读成」照旧给重试：读者点一下可能真的不一样。
    const failed = render({ positioning: { state: 'unavailable', cause: 'query-failed', onReload: () => undefined } })
    expect(failed).toContain(text.actionRetry)
    expect(failed).not.toContain(text.contractMismatch)
  })

  it('keeps the chart in the second column for all four cell combinations', () => {
    // 布局根因（Chief 2026-11-11）：`__body` 是两列网格，四个直接子元素自动排布时，多一行状态句
    // 就把图表挤进 264px 的左列、右列空着。网格里只许有两样：左列容器、右列图表容器。
    const combos = [
      { oi: 'available', funding: 'available' },
      { oi: 'available', funding: 'disabled' },
      { oi: 'disabled', funding: 'available' },
      { oi: 'disabled', funding: 'disabled' }
    ] as const
    for (const combo of combos) {
      const doc = new DOMParser().parseFromString(render({
        cells: { ...combo, reasons: {} }, onOpenSources: () => undefined
      }), 'text/html')
      const body = doc.querySelector('.mi-positioning-panel__body')!
      expect([...body.children].map(child => child.className.split(' ')[0]), JSON.stringify(combo)).toEqual([
        'mi-positioning-panel__summary', 'mi-positioning-panel__chart-wrap'
      ])
      expect(doc.querySelector('.mi-positioning-panel__chart-wrap')!.parentElement?.className, JSON.stringify(combo))
        .toContain('mi-positioning-panel__body')
    }
  })

  it('keeps the card frame in all three unavailable states, without one big status block', () => {
    const cases = [
      { cells: { oi: 'missing', funding: 'missing', reasons: {} }, sentence: text.sourceMissing },
      { cells: { oi: 'disabled', funding: 'disabled', reasons: {} }, sentence: text.sourceDisabled.replace('{source}', text.sourceName) },
      { cells: { oi: 'unreadable', funding: 'unreadable', reasons: { oi: 'query-failed', funding: 'query-failed' } }, sentence: text.sourceUnreadable }
    ] as const
    for (const item of cases) {
      const markup = render({ cells: item.cells, onOpenSources: () => undefined })
      expect(markup, item.sentence).toContain('data-asset="btc"')
      expect(markup, item.sentence).toContain('data-asset="eth"')
      expect(markup, item.sentence).toContain('data-chart-skeleton="true"')
      expect(markup, item.sentence).toContain(item.sentence)
      // 整块换成状态视图就是这段空白 + 一句话的由来。
      expect(markup, item.sentence).not.toContain('class="state-view')
    }
  })

  it('says 来源没有启用 and names the source on the row, keeping the other cell and the chart', () => {
    const markup = render({ cells: { oi: 'available', funding: 'disabled', reasons: {} }, onOpenSources: () => undefined })
    expect(markup).toContain(text.sourceDisabled.replace('{source}', text.sourceName))
    expect(markup).toContain(text.actionEnable)
    // 持仓那半照旧：名义额与图都在，整卡没有降级。
    expect(markup).toContain('$8.87B')
    expect(markup).toContain('mi-positioning-panel__chart')
    // 费率那半不留数字，但那一行还在（骨架），不是整行消失。
    expect(markup).not.toContain('+0.0062%')
    expect(markup).toContain('data-positioning-source-cell="disabled"')
  })

  it('says 暂时读不到 with a retry when the read failed, and never 未启用', () => {
    const retry = vi.fn()
    const markup = render({ cells: { oi: 'available', funding: 'unreadable', reasons: { funding: 'query-failed' } }, onReloadFunding: retry })
    expect(markup).toContain(text.sourceUnreadable)
    expect(markup).toContain(text.actionRetry)
    // 三态互不冒充：读不到不许写成未启用。
    expect(markup).not.toContain(text.sourceDisabled.replace('{source}', text.sourceName))
    expect(markup).not.toContain(text.sourceMissing)
  })

  it('tells a failed read from an empty one', () => {
    // Nothing collected is `empty`; a read that could not answer is `unreadable`. Mixing them is
    // how "we have nothing" and "we could not look" start reading alike.
    const failed = render({ positioning: { state: 'unavailable', cause: 'query-failed', onReload: () => undefined } })
    expect(failed).toContain('data-positioning-source-cell="unreadable"')
    expect(failed).toContain(text.sourceUnreadable)
    const empty = render({ positioning: { state: 'empty', onReload: () => undefined } })
    expect(empty).toContain('data-positioning-source-cell="empty"')
    expect(empty).toContain(text.empty)
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
    // 也不许先画一个空图表框：那同样是「已经有东西」的暗示。
    expect(markup).not.toContain('class="mi-positioning-panel__chart"')
  })

  it('flags a stale reading without dropping it', () => {
    // 投影给 available 视图同时带上两个时刻（`pointAt` / `newestReadingAt`）；滞后判的是最新读数，
    // 这个夹具里两者相同——这正是「读数确实旧了」的样子。
    const markup = render({ positioning: { ...availablePositioning, pointAt: at(120), newestReadingAt: at(120), staleSince: at(120) } })
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

describe('the truncated-hit count', () => {
  const hits = (count: number) => Array.from({ length: count }, (_, index) => ({
    asset: 'btc' as const,
    direction: 'long' as const,
    observedAt: at(30 + index * 20),
    notionalUsd: 8.9e9,
    dropPct: -1.9,
    volumeMultiple: 3
  }))

  it('draws the eight marks the DTO carries and says how many it could not draw', () => {
    const markup = render({ positioning: { ...availablePositioning, hints: hits(8), hiddenHits: 2 } })
    expect(markup.split('data-hint="').length - 1).toBe(8)
    expect(markup).toContain('图上还有 2 次疑似爆仓没有标出')
    expect(markup.split('data-hidden-hits').length - 1).toBe(1)
  })

  it('keeps the two lines apart: the count says nothing about the verdict, the verdict carries no number', () => {
    // 两处可以同时出现（图上有命中、而这次判定没读到），但各说各的：截断行不许提结论，判定行不许提数量。
    const markup = render({
      positioning: {
        ...availablePositioning,
        hints: hits(8),
        hiddenHits: 2,
        signal: { state: 'unreadable', failureCode: 'query-failed', onReload: () => undefined }
      }
    })
    expect(markup).toContain('图上还有 2 次疑似爆仓没有标出')
    expect(markup).toContain(text.liquidationNoteUnreadable)
    const count = markup.match(/data-hidden-hits[^>]*>([^<]*)</)?.[1] ?? ''
    expect(count).not.toMatch(/没有命中|读不到|不下结论/)
    const verdict = markup.match(/<p class="mi-positioning-panel__liquidation-note"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
    expect(verdict).not.toMatch(/\d+ 次/)
  })

  it('says nothing at all when every hit fits', () => {
    // 不截断时这一行**不渲染**——不是空着，也不许常驻：用户要的卡面是干净的。
    const markup = render({ positioning: { ...availablePositioning, hints: hits(5), hiddenHits: 0 } })
    expect(markup.split('data-hint="').length - 1).toBe(5)
    expect(markup.split('data-hidden-hits').length - 1).toBe(0)
    expect(markup).not.toContain('没有标出')
  })
})

describe('the one ⓘ on the reading dialog', () => {
  const notes = resolvePositioningNote('zh-CN')

  it('puts the ⓘ beside the title text, in the same left-aligned flow', async () => {
    const { entry } = await openReadings()
    const head = document.querySelector('.mi-positioning-panel__dialog-head')!
    expect(head).not.toBeNull()
    expect(head.children).toHaveLength(2)
    // 第一格是标题文字本身，第二格才是 ⓘ：相邻，不是各占一行、也不是被推到行尾。
    expect(head.children[0]!.tagName).toBe('H3')
    expect(head.children[0]!.textContent).toBe(text.signalDetailsTitle)
    // 第二格是 Popover 自己那层锚点 span，按钮在它里面；整行只有这一颗按钮。
    const icon = head.children[1]!.querySelector('button')
    expect(icon).not.toBeNull()
    expect(icon!.getAttribute('aria-label')).toBe('口径说明')
    expect(head.querySelectorAll('button')).toHaveLength(1)
    // 写法层面：容器规则里不许出现把图标推开的两种写法。
    const headRule = styles.match(/\.mi-positioning-panel__dialog-head \{([^}]*)\}/)?.[1] ?? ''
    expect(headRule).not.toContain('space-between')
    expect(headRule).not.toContain('margin-left: auto')
  })

  it('does not exist until the dialog is open, then carries every meta sentence', async () => {
    const { host, entry } = await mountPanel({ positioning: alertPositioning })
    // 弹层没开，就没有这颗 ⓘ。
    expect(host.querySelector('button[aria-label="口径说明"]')).toBeNull()

    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    const icon = document.querySelector<HTMLButtonElement>('button[aria-label="口径说明"]')
    expect(icon).not.toBeNull()
    // 正文里一句都不许有；打开 ⓘ 之后四句逐句都在。
    const body = document.querySelector('.mi-positioning-panel__help-dialog')!.textContent ?? ''
    for (const key of positioningNoteKeys) {
      expect(body).not.toContain(notes(key).slice(0, 12))
    }
    await act(async () => { icon!.focus() })
    await flush()
    for (const key of positioningNoteKeys) {
      expect(document.body.textContent).toContain(notes(key).slice(0, 12))
    }
  })
})

describe('the mark chips', () => {
  const mark = (overrides: Partial<{
    asset: 'btc' | 'eth'
    direction: 'long' | 'short'
    observedAt: string
    dropPct: number
    pricePct: number
    volumeMultiple: number
  }> = {}) => ({
    asset: 'btc' as const,
    direction: 'long' as const,
    observedAt: at(30),
    notionalUsd: 8.9e9,
    dropPct: -1.9,
    volumeMultiple: 3.4,
    ...overrides
  })
  const renderMarks = (hints: readonly ReturnType<typeof mark>[]) =>
    render({ positioning: { ...availablePositioning, hints, hiddenHits: 0 } })
  const chips = (markup: string) => [...markup.matchAll(/<rect x="([\d.]+)" y="3" width="([\d.]+)"/g)]
    .map(match => ({ left: Number(match[1]), width: Number(match[2]) }))
    .sort((first, second) => first.left - second.left)

  it('never draws a line without a chip, and never a chip without a line', () => {
    // 一簇一组：线、点、牌同组，所以「有竖线必须有牌」是结构保证，不是靠排版运气。
    const markup = renderMarks([mark(), mark({ asset: 'eth', observedAt: at(29) }), mark({ observedAt: at(120) })])
    const groups = markup.split('data-hint="').length - 1
    expect(groups).toBeGreaterThan(0)
    expect(markup.split('mi-positioning-panel__hint-chip').length - 1).toBe(groups)
    expect(markup.split('data-hint-count="').length - 1).toBe(groups)
  })

  it('takes its size from the one chart-label token, the same one the axis uses', () => {
    // 牌与轴标签同一档：写死一个 9 就会各改各的，两处对不齐也没人发现。
    const token = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    expect(token).toContain('--mi-chart-label-size: 9px')
    expect(styles).toMatch(/\.mi-positioning-panel__hint-chip text \{[^}]*font-size: var\(--mi-chart-label-size\)/)
    expect(styles).toMatch(/\.mi-positioning-panel__tick \{[^}]*font-size: var\(--mi-chart-label-size\)/)
    expect(styles).toMatch(/\.mi-positioning-panel__lane \{[^}]*font-size: var\(--mi-chart-label-size\)/)
    // 这张卡里不再有裸 9px 的字号。
    expect(styles).not.toMatch(/font-size:\s*9px/)
  })

  it('keeps the chip inside the plot when the hit sits on the right edge', () => {
    // 内收是「线不动、牌贴边」：最右那条的牌不许探出绘图区。
    const placed = chips(renderMarks([mark({ observedAt: at(120) }), mark({ observedAt: at(0) })]))
    expect(placed).toHaveLength(2)
    for (const chip of placed) expect(chip.left + chip.width).toBeLessThanOrEqual(992)
    expect(placed[1]!.left - (placed[0]!.left + placed[0]!.width)).toBeGreaterThanOrEqual(6)
  })

  it('merges a run of hits that cannot all fit into one chip', () => {
    // 放不下就并：连续命中并到一张牌上，并告诉你一共几次；不是各画一张压在一起。
    const packed = renderMarks([0, 1, 2, 3, 4, 5].map(minutes => mark({ observedAt: at(minutes) })))
    expect(chips(packed)).toHaveLength(1)
    expect(packed).toContain('疑似多头爆仓 ×6')
  })

  it('keeps at least 6px between two chips', () => {
    const markup = renderMarks([mark(), mark({ observedAt: at(29) }), mark({ asset: 'eth', observedAt: at(120) }), mark({ observedAt: at(0) })])
    const placed = chips(markup)
    expect(placed.length).toBeGreaterThan(1)
    for (let index = 1; index < placed.length; index += 1) {
      const gap = placed[index]!.left - (placed[index - 1]!.left + placed[index - 1]!.width)
      expect(gap).toBeGreaterThanOrEqual(6)
    }
  })

  it('writes the direction for a cluster of one, and the count for a cluster of many', () => {
    const single = renderMarks([mark({ direction: 'short', pricePct: 1.8 })])
    expect(single).toContain('疑似空头爆仓 +1.8%')
    // 同一刻两资产同向：牌放不下（< 6px），并成一簇，只写 ×2。
    const same = renderMarks([mark(), mark({ asset: 'eth' })])
    expect(same).toContain('疑似多头爆仓 ×2')
  })

  it('never names a direction on a mixed cluster', () => {
    const mixed = renderMarks([mark(), mark({ asset: 'eth', direction: 'short', pricePct: 1.8 })])
    expect(mixed).toContain('疑似爆仓 ×2')
    expect(mixed).not.toContain('疑似多头爆仓 ×2')
    expect(mixed).not.toContain('疑似空头爆仓 ×2')
  })

  it('keeps the truncation word off the chips: they count marks, the line under the chart counts the rest', () => {
    const markup = renderMarks([mark(), mark({ asset: 'eth' })])
    const chipText = [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join(' ')
    expect(chipText).not.toMatch(/未标出|共/)
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
      { state: 'unavailable' as const, cause: 'query-failed' as const, onReload: () => undefined },
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
    // 正文只剩读数与证据：口径说明那几段一句都不许铺在正文里。
    expect(document.querySelector('#mi-positioning-signal-detail')?.getAttribute('aria-label')).toBe(text.signalDetailsTitle)
    expect(surface!.textContent).toContain(text.signalDetailsRuleName)
    for (const sentence of ['六档判定', '只标 15 分钟内的骤降', '相对过去 24 小时同长度桶均量的倍数', '两者都只代表']) {
      expect(surface!.textContent).not.toContain(sentence)
    }
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
  it('names what the multiple measures, behind the ⓘ', async () => {
    // A bare "3.4×" said nothing about what was multiplied; the sentence is a definition, so it
    // lives behind the one ⓘ rather than in the body.
    const { entry } = await openReadings()
    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    const icon = document.querySelector<HTMLButtonElement>('button[aria-label="口径说明"]')!
    expect(icon).not.toBeNull()
    await act(async () => { icon.focus() })
    await flush()
    expect(document.body.textContent).toContain('相对过去 24 小时同长度桶均量的倍数')
  })
})

describe('the module rule chip', () => {
  const alert = (overrides: Record<string, unknown> = {}): DashboardPositioningViewState => ({
    state: 'available' as const,
    window: '7d' as const,
    hints: [] as const,
    hiddenHits: 0 as const,
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
    // 弹层无头（名字给读屏），可见标题画在正文第一行、ⓘ 紧跟其后。
    expect(dialog()?.textContent).toContain(text.signalDetailsTitle)
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
