// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { resolveStateViewText } from '@platform/ui/components/state/stateViewText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
/** Every host can retry; tests that do not care about the action still need a reachable one. */
const englishCapitalConditions = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

/** The app always has a language in context; the harness has to supply the one the fixture is written in. */
const ScopedCapitalConditionsPanel = (props: Omit<Parameters<typeof CapitalConditionsPanel>[0], 'onRefresh'> & { onRefresh?: () => void }): React.ReactElement =>
  createElement(ShellLanguageProvider, {
    language: props.text === englishCapitalConditions ? 'en-US' : 'zh-CN',
    // children 是必填 props，不是 createElement 的第三个参数：那个位置在类型上要求 props 先满足，
    // 于是同一份代码在提交树里会报 TS2769。统一写成 props.children，两个测试文件一个写法。
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, { onRefresh: () => undefined, ...props })
    })
  })

/** The platform state icon is inline SVG; its namespace is the one URL a clean panel may carry. */
const withoutSvgNamespace = (markup: string): string => markup.replaceAll('xmlns="http://www.w3.org/2000/svg"', '')

const dashboardStyles = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'),
  'utf8'
)

let root: Root | undefined


afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

describe('CapitalConditionsPanel', () => {
  it.each(['zh-CN', 'en-US'] as const)('renders %s stock and ETF tables without a panel title', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const state = fullState()
    state.currentUsd = '$254.9B'
    state.change1dUsd = '+$42M'
    state.change1dPercent = '+0.17%'
    state.change7dUsd = '+$82.4M'
    state.change7dPercent = '+0.03%'
    state.change30dUsd = '-$500M'
    state.change30dPercent = '-0.21%'
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))

    expect(markup).toContain('class="mi-capital-conditions__header-band"')
    expect(markup).toContain(`aria-label="${text.title}"`)
    expect(markup).toContain('class="mi-capital-conditions__observed-at"')
    expect(markup).toContain(`<h2>${text.title}</h2>`)
    expect(markup).toMatch(new RegExp(`<div class="mi-capital-conditions__header-band"><h2>${text.title}</h2><small class="mi-capital-conditions__observed-at">`))
    expect(markup).toContain('2026-08-18 07:00 GMT')
    expect(markup).toContain('mi-capital-conditions__stable-table')
    expect(markup).toContain(`<th scope="col">${text.asset}</th>`)
    expect(markup).toContain(`<th scope="col">${text.totalSupply}</th>`)
    for (const label of [text.change1d, text.change7d, text.change30d]) expect(markup).toContain(`<th scope="col">${label}<span`)
    expect(markup).toContain(`<span class="mi-capital-conditions__asset-name">${text.stablecoin}</span>`)
    expect(markup).toContain(`<span class="mi-capital-conditions__asset-scope">${text.stablecoinScope}</span>`)
    expect(markup).toContain('$254.9B')
    for (const value of ['+$42M', '+0.17%', '+$82.4M', '+0.03%', '-$500M', '-0.21%']) expect(markup).toContain(value)
    expect(markup).toContain('class="mi-capital-conditions__etf-table"')
    expect(markup).toContain(`<th scope="col">${text.latest}</th>`)
    expect(markup).toContain(`<th scope="col">${text.latest}</th>`)
    expect(markup).toContain(format(text.windowDays, { days: 5 }))
    expect(markup).toContain(format(text.windowDays, { days: 20 }))
    expect(markup).toContain(`<th scope="col">${text.streakColumn}</th>`)
    expect(markup).toContain(text.btc)
    expect(markup).toContain(text.eth)
    expect(markup).toContain('data-flow-direction="inflow"')
    expect(markup).toContain('data-flow-direction="outflow"')
    expect(markup).not.toMatch(/static sample|静态样例/i)
    expect(markup).not.toContain('mi-crypto-dashboard__state-card')
  })

  it('stacks the stablecoin table above the ETF table beside the chart', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))

    expect(markup.indexOf('mi-capital-conditions__header-band')).toBeLessThan(markup.indexOf('mi-capital-conditions__stable-table'))
    expect(markup.indexOf('mi-capital-conditions__stable-table')).toBeLessThan(markup.indexOf(text.btc))
    expect(markup.indexOf('mi-capital-conditions__summary')).toBeLessThan(markup.indexOf('mi-capital-conditions__etf-flow'))
    expect(markup).toContain('class="mi-capital-conditions__content-row"')
  })

  it('renders the consecutive direction and day count in the table streak column', () => {
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: streakState() }))
    const body = etfTableBody(markup)

    expect(body).toContain(format(text.streak, { flow: text.flowDirections.inflow, count: 3 }))
    expect(body).toContain(format(text.streak, { flow: text.flowDirections.outflow, count: 5 }))
    expect(markup).toContain('mi-capital-conditions__streak')
  })

  it.each(['zh-CN', 'en-US'] as const)('puts the real %s 20-day coverage in the column header', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: degradedState() }))
    const twentyHeader = markup.match(new RegExp(`<th scope="col">${format(text.windowDays, { days: 20 })}.*?</th>`))?.[0] ?? ''
    const fiveHeader = markup.match(new RegExp(`<th scope="col">${format(text.windowDays, { days: 5 })}.*?</th>`))?.[0] ?? ''

    expect(twentyHeader).toContain(format(text.coverage, { days: 12 }))
    expect(fiveHeader).not.toContain(format(text.coverage, { days: 12 }))
    expect(markup).not.toContain('20 日窗口仅覆盖')
    expect(markup).toContain('12')
  })

  it.each(['zh-CN', 'en-US'] as const)('shows the %s ETF table as unavailable without inventing numbers', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const state = { ...fullState(), etfReading: unreadableReading() }
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))
    const body = etfTableBody(markup)

    // Both halves answer through the platform error state: a part of the panel that could not be
    // read is still "could not read", and neither half may fall back to a sentence of its own.
    expect(body).toContain('data-state="error"')
    const bodyText = body.replace(/<[^>]*>/g, '')
    expect(bodyText).not.toMatch(/\d/)
    expect(markup).toContain('$1B')
    expect(markup).toContain('data-etf-flow="unavailable"')
    const flow = /data-etf-flow="unavailable"([\s\S]*?)<\/section>/.exec(markup)![1]!
    expect(flow).toContain('data-state="error"')
  })

  it('renders one shared zero-axis chart with exactly three series per day', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, {
      text,
      state: {
        state: 'available', conclusion: 'partial', observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
        flowHistory: { state: 'available', rows: [{ tradingDate: '2026-08-17', funds: 1_000_000, btc: 2_000_000, eth: -3_000_000 }, { tradingDate: '2026-08-18', funds: 0, btc: 0, eth: 0 }] },
        etfReading: {
          state: 'available',
          comparison: { state: 'aligned' },
          coverage: [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }],
          btc: { asset: 'BTC', latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: [{ tradingDate: '2026-08-17', direction: 'inflow', magnitudePercent: 100 }, { tradingDate: '2026-08-18', direction: 'zero', magnitudePercent: 0 }] },
          eth: { asset: 'ETH', latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: [{ tradingDate: '2026-08-18', direction: 'outflow', magnitudePercent: 100 }] }
        }
      } as never
    }))

    expect(markup).toContain('data-etf-flow="available"')
    expect(markup).toContain('data-series="funds"')
    expect(markup).toContain('data-series="btc"')
    expect(markup).toContain('data-series="eth"')
    expect(markup).toContain('data-flow-half="inflow"')
    expect(markup).toContain('data-flow-half="outflow"')
    expect(markup).toContain('data-flow="zero"')
    expect(markup).not.toContain('data-etf-flow-window=')
  })

  it('defaults the shared chart to the latest seven complete days without a window control', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))
    // Two controls in the title row: the info bubble and the daily-data trigger. No window switcher.
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('data-etf-flow-window=')
    expect((markup.match(/class="mi-capital-conditions__chart-day"/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="funds" data-flow/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="btc" data-flow/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="eth" data-flow/g) ?? []).length).toBe(7)
    expect(markup).not.toContain('data-trading-date="2026-08-01"')
    expect(markup).toContain('data-trading-date="2026-08-30"')
  })

  it('uses the latest seven days and all three series to share the maximum axis magnitude', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    // The seven-day cut happens in the projection; the panel renders what it is handed.
    const rows = Array.from({ length: 7 }, (_, index) => ({
      tradingDate: `2026-08-${String(index + 2).padStart(2, '0')}`,
      funds: index * 1_000_000,
      btc: index * 2_000_000,
      eth: index === 6 ? -24_000_000 : -index * 1_000_000
    }))
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))

    expect(markup).toContain('$24M')
    expect(markup).toContain('$0')
    expect(markup).toContain('-$24M')
    expect(markup).toContain('data-series="eth" data-flow="outflow" style="--mi-flow-height:100%"')
  })

  it('scales a short flow history from only its actual rows', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const rows = [
      { tradingDate: '2026-08-17', funds: 3_000_000, btc: -4_000_000, eth: 5_000_000 },
      { tradingDate: '2026-08-18', funds: -12_000_000, btc: 2_000_000, eth: 0 }
    ]
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))

    expect(markup).toContain('$12M')
    expect(markup).toContain('-$12M')
    expect(markup).not.toContain('2026-08-01')
    expect((markup.match(/class="mi-capital-conditions__chart-day"/g) ?? []).length).toBe(2)
  })

  it('renders a single safe zero axis and zero-height bars when all visible flows are zero', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const rows = [
      { tradingDate: '2026-08-17', funds: 0, btc: 0, eth: 0 },
      { tradingDate: '2026-08-18', funds: 0, btc: 0, eth: 0 }
    ]
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))
    const axisMarkup = markup.match(/<div class="mi-capital-conditions__chart-axis"[^>]*>(.*?)<\/div>/)?.[1] ?? ''

    expect(markup).toContain('data-zero-axis="true"')
    expect(axisMarkup.match(/<span>/g) ?? []).toHaveLength(1)
    expect(axisMarkup).toContain('$0')
    expect(axisMarkup).not.toContain('+$0')
    expect(axisMarkup).not.toContain('-$0')
    expect((markup.match(/data-flow="zero"[^>]*style="--mi-flow-height:0%"/g) ?? []).length).toBe(6)
  })

  it('keeps the shared-axis maximum at full half-axis height without a second CSS scale', () => {
    expect(dashboardStyles).toContain('height: var(--mi-flow-height);')
    expect(dashboardStyles).not.toContain('height: calc(var(--mi-flow-height) * .5);')
  })

  it('shows the selected day in a three-series flow legend when a chart day is hovered', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))
    const day = container.querySelector<HTMLElement>('[data-trading-date="2026-08-24"]')!
    await act(async () => day.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))

    const legend = container.querySelector<HTMLElement>('[data-flow-tooltip]')!
    expect(legend.textContent).toContain('2026-08-24')
    expect(legend.textContent).toContain(text.fundsColumn)
    expect(legend.textContent).toContain(text.btc)
    expect(legend.textContent).toContain(text.eth)
    expect(legend.textContent).toContain('+$13')
    expect(legend.textContent).toContain('+$24')
    expect(legend.textContent).toContain('-$24')
  })

  it('moves the flow tooltip and crosshair with the pointer inside the chart', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))
    const chart = container.querySelector<HTMLElement>('.mi-capital-conditions__chart')!
    Object.defineProperty(chart, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 700, bottom: 324, width: 600, height: 124 })
    })
    const day = container.querySelector<HTMLElement>('[data-trading-date="2026-08-24"]')!

    await act(async () => day.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 202 })))
    const tooltip = container.querySelector<HTMLElement>('[data-flow-tooltip]')!
    const vertical = container.querySelector<HTMLElement>('[data-flow-crosshair="vertical"]')!
    const horizontal = container.querySelector<HTMLElement>('[data-flow-crosshair="horizontal"]')!
    const firstPlacement = { left: tooltip.style.left, top: tooltip.style.top, vertical: vertical.style.left, horizontal: horizontal.style.top }

    await act(async () => day.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 450, clientY: 318 })))

    expect(tooltip.style.left).not.toBe(firstPlacement.left)
    expect(tooltip.style.top).not.toBe(firstPlacement.top)
    expect(vertical.style.left).not.toBe(firstPlacement.vertical)
    expect(horizontal.style.top).not.toBe(firstPlacement.horizontal)

    await act(async () => day.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(container.querySelector('[data-flow-tooltip]')).toBeNull()
    expect(container.querySelector('[data-flow-crosshair="vertical"]')).toBeNull()
    expect(container.querySelector('[data-flow-crosshair="horizontal"]')).toBeNull()
  })

  it('can transition from an unavailable ETF to an interactive chart', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, {
      text,
      state: { state: 'available', conclusion: 'partial', etfReading: unreadableReading(), observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%' }
    })))
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))

    expect(container.querySelector('[data-etf-flow="available"]')).not.toBeNull()
  })

  it.each(['zh-CN', 'en-US'] as const)('does not fabricate an observation time for the %s non-available states', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    for (const state of [{ state: 'loading' as const }, { state: 'empty' as const }, { state: 'unavailable' as const, reason: 'query-failed' as const }]) {
      const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))
      expect(markup).not.toContain(text.observedAt)
      expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT/)
    }
  })

  it('renders the empty state through the platform StateView, with the card sentence in its reason slot', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'empty' } }))
    expect(markup).toContain('data-state="empty"')
    expect(markup).toContain('data-size="md"')
    // The card says what is missing in its own words; the slot is the platform's reason slot, so
    // the title, icon and announcement still belong to the platform.
    expect(markup).toContain(text.empty)
    // No word from the internal vocabulary can come back through that sentence.
    expect(markup.toLowerCase()).not.toContain('snapshot')
    expect(withoutSvgNamespace(markup)).not.toMatch(/https?:|raw|payload|proxy|error/i)
  })

  it('tells a failed read apart from an empty one, without tearing the tables down', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable', reason: 'query-failed' } }))
    const empty = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'empty' } }))

    // "Could not read" is an error, never an empty: a panel that says "nothing here" when the
    // query failed tells the reader the opposite of what happened.
    // 而且「读不到」不把表拆掉：表头与行名留着、数据格空着，一句状态 + 一颗动作在表头下面那一行。
    expect(markup).toContain(productText['en-US'].pages.intelligence.portal.data.temporarilyUnavailable)
    expect(markup).toContain('data-status-row="unavailable"')
    expect(markup).toContain('mi-capital-conditions__stable-table')
    expect(empty).toContain('state-view--empty')
    expect(empty).not.toContain('data-status-row=')
    expect(markup).not.toContain('mi-source-card')
    expect(withoutSvgNamespace(markup)).not.toMatch(/https?:|raw|payload|proxy/i)
  })

  it('shows \u201cinsufficient data\u201d as a statement, not a control, and draws no number', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, {
      text, state: { ...fullState(), etfSignal: { state: 'insufficient' as const } }
    }))

    // 「数据不齐」是陈述不是控件：背后没有可展开的读数，做成按钮只会让人点个空。
    expect(markup).toContain('status-pill')
    expect(markup).toContain(text.signalInsufficient)
    expect(markup).not.toContain('mi-capital-conditions__signal"')
    // 数据不齐时牌子里的字一个数字都不许有：拿不到不许被画成「很小」。
    const pillLabel = markup.match(/status-pill__label">(.*?)<\/span>/)?.[1] ?? ''
    expect(pillLabel).toBe(text.signalInsufficient)
    expect(pillLabel).not.toMatch(/[\d$%]/)
    // 陈述不是控件：牌子本身不再是按钮，也没有可展开的读数；旁边的 ⓘ 才是控件（下一例断言）。
    const header = markup.slice(markup.indexOf('mi-capital-conditions__header-band'), markup.indexOf('</div>', markup.indexOf('mi-capital-conditions__header-band')))
    expect(header).not.toContain('mi-capital-conditions__signal-statement')
    expect(markup).toMatch(new RegExp(`<h2>${text.title}</h2><span class="status-pill`))
  })

  // 说明图标统一：IconButton(sm+plain) + Popover；读屏名 = 它解释的东西 + 「说明」；
  // 浮层文字挂在触发件的 aria-describedby 上；Tooltip 不再用于这种独立说明图标。
  it('explains the insufficient chip through one info button, not a tooltip', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { ...fullState(), etfSignal: { state: 'insufficient' as const } } })))

    const header = container.querySelector('.mi-capital-conditions__header-band')!
    const info = header.querySelector<HTMLButtonElement>('button.icon-button')!
    expect(info).not.toBeNull()
    // 读屏名逐字：不念「更多信息」，也不把整段说明当名字。
    expect(info.getAttribute('aria-label')).toBe(text.signalInsufficientHelpLabel)
    expect(info.className).toContain('icon-button--sm')
    expect(info.className).toContain('icon-button--plain')
    expect(info.getAttribute('aria-expanded')).toBe('false')

    // 聚焦即展开，Esc 收起并回焦。
    await act(async () => { info.focus() })
    // 等「展开」这个事实出现，不等一个固定毫秒：浮层是在 focus 之后异步挂上的。
    await vi.waitFor(() => expect(info.getAttribute('aria-expanded')).toBe('true'))
    expect(document.body.textContent).toContain(text.signalInsufficientReason)
    // 说明关系是真的：触发件指到的那个 id 必须**查得到节点**、且节点里就是那段说明。
    // 只断言「属性存在」会恒真（antd 触发层自己会挂一个指向 `test-id` 的值），所以查三层：
    // 属性 → 节点 → 节点文本。触发器用的是真实 `IconButton`（props 收窄，不转发就静默丢掉）。
    const describedBy = info.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const described = document.getElementById(describedBy!)
    expect(described).not.toBeNull()
    expect(described!.textContent).toContain(text.signalInsufficientReason)
    await act(async () => {
      info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await vi.waitFor(() => expect(info.getAttribute('aria-expanded')).toBe('false'))
    expect(document.activeElement).toBe(info)
    // 一处只有一颗：牌位里没有第二颗说明图标。
    expect(header.querySelectorAll('button.icon-button').length).toBe(1)
  })

  // 标题行（含 ⓘ）：间距 4px；窄卡时**先坏动作、不拆解释**。断的是规则本身，不是「我改过了」。
  it('keeps the flow block title line at the 4px gap the rule names', () => {
    const sheet = readFileSync(
      resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    const ruleBody = (selector: string): string => {
      const body = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(sheet)?.[1]
      expect(body).toBeTruthy()
      return body!
    }

    const header = ruleBody('.mi-capital-conditions__etf-flow > header')
    // 注释里的禁止说明不算命中：只在规则体内查声明。
    expect(header).toMatch(/gap:\s*4px/)
    expect(header).not.toMatch(/justify-content:\s*space-between/)
    // 整行允许换行：窄卡时换的是动作。ⓘ 的「不许被推走」由下面那一组保证。
    expect(header).toMatch(/flex-wrap:\s*wrap/)

    // 标题 + ⓘ 成组且组内不换行：解释永远贴着它解释的那句话。
    const titleGroup = ruleBody('.mi-capital-conditions__etf-flow-title')
    expect(titleGroup).toMatch(/flex-wrap:\s*nowrap/)
    expect(titleGroup).toMatch(/min-width:\s*72px/)

    // 文字让位：标题可缩到 0 并省略；图标固定不被挤压；动作也不被挤压。
    const title = ruleBody('.mi-capital-conditions__etf-flow-title h3')
    expect(title).toMatch(/min-width:\s*0/)
    expect(title).toMatch(/text-overflow:\s*ellipsis/)
    expect(ruleBody('.mi-capital-conditions__etf-flow-title .icon-button')).toMatch(/flex:\s*none/)
    expect(ruleBody('.mi-capital-conditions__daily-button')).toMatch(/flex:\s*none/)
    expect(ruleBody('.mi-capital-conditions__daily-button')).toMatch(/margin-left:\s*auto/)
  })

  it('draws no chip at all while the rule had nothing to say', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))
    expect(markup).not.toContain('mi-capital-conditions__signal')
  })

  /** 弹层已关的三种可观察形态：卸载、离场动画中、遮罩隐藏。 */
  const modalClosed = (): boolean => {
    const dialog = document.querySelector('.mi-capital-signal-dialog')
    if (!dialog) return true
    if (dialog.classList.contains('ant-zoom-leave')) return true
    return (document.querySelector('.ant-modal-wrap')?.getAttribute('style') ?? '').includes('display: none')
  }

  const alertState = () => ({
    ...fullState(),
    // 「这次分析」这一组只在这句存在时出现，所以夹具要给它一句。
    etfSignalAnalysis: { analysisOffByReader: false, analysisState: 'queued' as const },
    etfSignal: {
      state: 'alert' as const, asset: 'btc' as const, amountUsd: '$488.7M', cumulativeUsd: '-$488.7M',
      coveredDays: 3, requiredDays: 3, observedAt: '2026-10-30T00:00:00.000Z'
    }
  })

  async function renderAlert() {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: alertState() })))
    return { text, container }
  }

  // 判据一：常驻区里搜不到那段说明的任何一句 —— 连折叠标题也不许留。
  it('keeps the explanation out of the resident card entirely', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: alertState() }))

    expect(markup).not.toContain(text.signalDetailNote)
    expect(markup).not.toContain(text.signalDetailRule)
    expect(markup).not.toContain(text.signalRuleWindow)
    expect(markup).not.toContain(text.signalDetailTradingDay)
    expect(markup).not.toContain('mi-capital-conditions-signal-detail')
    // 也没有第二个入口：牌子就是入口。
    expect(markup).not.toContain('mi-capital-conditions__detail-entry')
  })

  // 判据二：点牌子 → 弹层出现，且含规范里的三组。
  it('opens the dialog from the chip itself, with its three groups', async () => {
    const { text, container } = await renderAlert()
    const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
    expect(chip.tagName).toBe('BUTTON')
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog')
    // 不是就地展开的控件：不写 aria-expanded；读屏名 = 可见读数 + 点开会做什么。
    expect(chip.getAttribute('aria-expanded')).toBeNull()
    expect(chip.getAttribute('aria-label')).toBe(
      text.signalChipOpen.replace('{chip}', text.signalChip.replace('{amount}', '$488.7M')))
    // 常驻的「点开有东西」：一枚 6px 的 ›。
    expect(chip.querySelector('.mi-capital-conditions__signal-chevron')).not.toBeNull()

    await act(async () => chip.click())

    const dialog = document.querySelector<HTMLElement>('.mi-capital-signal-dialog')!
    expect(dialog).not.toBeNull()
    const content = dialog.textContent ?? ''
    expect(content).toContain(text.signalDetailDialogTitle)
    // 「这次分析」只在投影出那句话时出现，由下面的弹层单测覆盖；卡面这一层断言另外两组。
    expect(content).toContain(text.signalDetailGroupReadings)
    expect(content).toContain(text.signalDetailGroupTime)
    // 读数本身与落款都在弹层里，白话名照旧不出现内部标识。
    expect(content).toContain('-$488.7M')
    expect(content).toContain('3/3')
    expect(content).toContain('2026-10-30')
    // 说明性文字不再铺在正文里；读数、流水与时间照旧一行不动。
    expect(content).not.toContain(text.signalDetailNote)
    expect(content).not.toContain('etf-outflow-3d')
  })

  // 说明收进一颗 ⓘ：正文命中 0，打开后逐句都在（与背离卡同一形态）。
  it('keeps the meta explanation behind one info button, not in the body', async () => {
    const { text, container } = await renderAlert()
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!.click())

    const body = document.querySelector<HTMLElement>('.mi-capital-signal-dialog__body')!
    expect(body.textContent).not.toContain(text.signalDetailNote)

    const info = body.querySelector<HTMLButtonElement>('.icon-button')!
    expect(info).not.toBeNull()
    await act(async () => { info.focus() })
    // 等那句话本身出现；固定毫秒只是在赌它多快挂上。
    await vi.waitFor(() => expect(document.body.textContent).toContain(text.signalDetailNote))
    expect(document.querySelector('.mi-capital-signal-dialog')).not.toBeNull()
  })

  // 标题与 ⓘ 必须真的同一行、相邻：它在窄容器里掉到第二行，是因为被推到了行尾。
  it('keeps the title and its info button in one non-wrapping row', async () => {
    const { container } = await renderAlert()
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!.click())

    const head = document.querySelector<HTMLElement>('.mi-capital-signal-dialog__head')!
    const title = head.querySelector<HTMLElement>('.mi-capital-signal-dialog__title')!
    const info = head.querySelector<HTMLButtonElement>('button.icon-button')!
    expect(title).not.toBeNull()
    expect(info).not.toBeNull()
    // 同一行容器，且图标是标题的**相邻兄弟**（中间没有别的元素把它顶到别处）。
    expect(head.contains(title)).toBe(true)
    expect(title.nextElementSibling).toBe(info.closest('.platform-popover__anchor'))

    // 容器规则里不许出现把图标推到行尾或允许换行的写法。
    const sheet = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/capital-conditions/capitalSignalDialog.css'), 'utf8')
    const rule = /\.mi-capital-signal-dialog__head\s*\{([^}]*)\}/.exec(sheet)![1]!
    expect(rule).not.toMatch(/justify-content:\s*space-between/)
    expect(rule).not.toMatch(/margin-left:\s*auto/)
    expect(rule).not.toMatch(/flex-wrap:\s*wrap/)
    expect(rule).toMatch(/flex-wrap:\s*nowrap/)
    // 文字负责让位：标题截断、图标固定大小。
    expect(/\.mi-capital-signal-dialog__title\s*\{([^}]*)\}/.exec(sheet)![1]!).toMatch(/text-overflow:\s*ellipsis/)
  })

  // 判据三：× / Esc / 遮罩三种关法，各关一次都能关，关后焦点回到牌子。
  async function openThen(close: () => void) {
    const { container } = await renderAlert()
    const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
    await act(async () => chip.click())
    expect(document.querySelector('.mi-capital-signal-dialog')).not.toBeNull()
    await act(async () => { close() })
    expect(modalClosed()).toBe(true)
    expect(document.activeElement).toBe(chip)
    await act(async () => root?.unmount())
    root = undefined
    container.remove()
    document.body.replaceChildren()
  }

  it('closes on the cross and returns focus to the chip', async () => {
    await openThen(() => document.querySelector<HTMLElement>('.ant-modal-close')!.click())
  })

  it('closes on Escape and returns focus to the chip', async () => {
    await openThen(() => {
      const content = document.querySelector<HTMLElement>('.ant-modal-content') ?? document.body
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
    })
  })

  it('closes on the mask and returns focus to the chip', async () => {
    await openThen(() => document.querySelector<HTMLElement>('.ant-modal-wrap')!.click())
  })

  // 判据四：没有信号就没有可解释的读数 —— 牌子不渲染，也就没有弹层入口。
  it('offers no dialog when there is nothing to explain', async () => {
    for (const etfSignal of [{ state: 'insufficient' as const }, { state: 'hidden' as const }]) {
      const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
      const container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { ...fullState(), etfSignal } })))
      expect(container.querySelector('.mi-capital-conditions__signal')).toBeNull()
      expect(container.querySelector('.mi-capital-conditions__detail-entry')).toBeNull()
      await act(async () => root?.unmount())
      root = undefined
      container.remove()
      document.body.replaceChildren()
    }
  })

  // 三条会先红的用例：同一元素既要弹说明、又要响应点击。
  it('opens on click even though a tooltip hangs on the same element', async () => {
    const { container } = await renderAlert()
    const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
    // 说明先出现（聚焦通道），再点：点击不能被说明吞掉。
    await act(async () => { chip.focus() })
    await act(async () => chip.click())
    expect(document.querySelector('.mi-capital-signal-dialog')).not.toBeNull()
  })

  it('shows the rule explanation on focus, without waiting for a hover', async () => {
    const { text, container } = await renderAlert()
    const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
    expect(document.body.textContent).not.toContain(text.signalRuleName)

    await act(async () => { chip.focus() })
    await vi.waitFor(() => expect(document.body.textContent).toContain(text.signalRuleName))

    expect(document.body.textContent).toContain(text.signalRuleWindow)
  })

  it('keeps the chip usable by keyboard: Enter and Space open the dialog', async () => {
    for (const key of ['Enter', ' ']) {
      const { container } = await renderAlert()
      const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
      await act(async () => chip.click())
      expect(document.querySelector('.mi-capital-signal-dialog')).not.toBeNull()
      await act(async () => root?.unmount())
      root = undefined
      container.remove()
      document.body.replaceChildren()
      expect(key).toBeDefined()
    }
  })

  it('keeps the initial loading state short and free of diagnostic data', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'loading' } }))
    expect(markup).toContain(text.loading)
    expect(withoutSvgNamespace(markup)).not.toMatch(/https?:|raw|payload|proxy|error/i)
  })

  it('gives the failed card a reachable retry instead of a dead end', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const onRefresh = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable', reason: 'query-failed' }, onRefresh })))
    const action = container.querySelector<HTMLButtonElement>('[data-status-row="unavailable"] button')!
    expect(action).not.toBeNull()
    await act(async () => action.click())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('gives both unavailable ETF surfaces the same retry as the card', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const onRefresh = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const state = { ...fullState(), etfReading: unreadableReading() }
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state, onRefresh })))
    const actions = [...container.querySelectorAll<HTMLButtonElement>('.state-view__action')]
    expect(actions).toHaveLength(2)
    await act(async () => actions[0]!.click())
    await act(async () => actions[1]!.click())
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it.each(['zh-CN', 'en-US'] as const)('gives %s readers exactly one action on the read-failure state', async (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const onRefresh = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable', reason: 'query-failed' }, onRefresh })))
    // 状态行里恰一颗动作，文字取产品那句「再试一次」（用户 2026-11-11 定的三句之一）；
    // 同一张卡里不许再出现第二颗做同一件事的按钮。
    const actions = [...container.querySelectorAll<HTMLButtonElement>('button')]
    expect(actions).toHaveLength(1)
    expect(actions[0]?.textContent).toBe(productText[locale].pages.intelligence.portal.data.retry)
    await act(async () => actions[0]!.click())
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain(text.refreshFailed)
  })

  it('marks the kept readings as previous ones instead of presenting them as fresh', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const state = { ...fullState(), stale: true as const }
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state, onRefresh: () => undefined }))

    expect(markup).toContain(text.staleRead)
    // The readings themselves are still on the page: "old" is not "gone".
    expect(markup).toContain('$1B')
  })

  it('does not claim staleness on a fresh read', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState(), onRefresh: () => undefined }))
    expect(markup).not.toContain(text.staleRead)
  })

  it('reports a failed re-collection as a notice, with no second button for the same action', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable', reason: 'query-failed' }, onRefresh: () => undefined, refreshFailed: true })))
    // 平台提示条：danger 自带 role="alert"，正文是那一句。
    const notice = container.querySelector('[data-inline-notice="danger"]')
    expect(notice?.getAttribute('role')).toBe('alert')
    expect(notice?.textContent).toContain(text.refreshFailed)
    // 提示条只报事：同一个 `onRefresh` 在状态面里已经有一颗，这里不许再挂一颗做同一件事的按钮。
    expect(notice?.querySelector('button')).toBeNull()
    expect([...container.querySelectorAll<HTMLButtonElement>('button')]).toHaveLength(1)

    // `loading` already means a read is in flight, so the control must not start a second one.
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'loading' }, onRefresh: () => undefined, refreshing: true })))
    expect(container.querySelector<HTMLButtonElement>('.mi-capital-conditions__refresh')!.disabled).toBe(true)
  })
})

function flowState(rows: readonly { tradingDate: string; funds: number; btc: number; eth: number }[]) {
  return {
    state: 'available' as const,
    conclusion: 'partial' as const,
    observedAt: '2026-08-18T07:00:00.000Z',
    currentUsd: '$1B',
    change1dUsd: '$0',
    change1dPercent: '0.00%',
    change7dUsd: '$0',
    change7dPercent: '0.00%',
    change30dUsd: '$0',
    change30dPercent: '0.00%',
    flowHistory: { state: 'available' as const, rows },
    etfReading: {
      state: 'available' as const,
      comparison: { state: 'aligned' as const },
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: [] },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: [] }
    }
  }
}

function fullState() {
  // 每行都带净流金额：型号（`DashboardEtfFlowRow`）要求它，缺了这条夹具就是**过期的形状**。
  const rows = Array.from({ length: 30 }, (_, index) => ({
    tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
    netFlowUsd: index === 29 ? 0 : (index + 1) * 1_000_000,
    direction: index === 29 ? 'zero' as const : 'inflow' as const,
    magnitudePercent: index === 29 ? 0 : index + 1
  }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    // Mirrors the projection: it already cut the window to the last seven days before the panel sees it.
    flowHistory: { state: 'available' as const, rows: Array.from({ length: 30 }, (_, index) => ({ tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`, funds: (index - 10) * 1_000_000, btc: (index + 1) * 1_000_000, eth: -(index + 1) * 1_000_000 })).slice(-7) },
    etfReading: {
      state: 'available' as const,
      comparison: { state: 'aligned' as const },
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: rows.map((row) => ({ ...row, direction: row.direction === 'zero' ? 'zero' as const : 'outflow' as const })) }
    }
  }
}

function streakState() {
  const btcRows = Array.from({ length: 5 }, (_, index) => ({
    tradingDate: `2026-08-${String(index + 26).padStart(2, '0')}`,
    netFlowUsd: (index + 1) * 1_000_000,
    direction: index < 2 ? 'outflow' as const : 'inflow' as const,
    magnitudePercent: index + 1
  }))
  const ethRows = btcRows.map((row) => ({ ...row, direction: 'outflow' as const }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    etfReading: {
      state: 'available' as const,
      comparison: { state: 'aligned' as const },
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: btcRows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: ethRows }
    }
  }
}

function degradedState() {
  const state = fullState()
  state.etfReading.coverage = [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 12, complete: false }]
  state.etfReading.btc.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
  ]
  state.etfReading.eth.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
  ]
  return state
}

function completeCoverage() {
  return [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }]
}

const unreadableReading = () => ({
  state: 'unreadable' as const,
  comparison: { state: 'aligned' as const },
  coverage: []
})

function cumulativeWindows(amount: string) {
  return [
    { windowDays: 5, coveredDays: 5, netFlowUsd: amount, complete: true },
    { windowDays: 20, coveredDays: 20, netFlowUsd: amount, complete: true }
  ]
}

function etfTableBody(markup: string): string {
  const table = markup.match(/<table class="mi-capital-conditions__etf-table">([\s\S]*?)<\/table>/)?.[1] ?? ''
  return table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? ''
}

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''))
}
