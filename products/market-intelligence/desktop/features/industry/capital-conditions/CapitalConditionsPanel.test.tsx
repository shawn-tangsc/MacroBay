// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
/** Every host can retry; tests that do not care about the action still need a reachable one. */
const englishCapitalConditions = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

/** The app always has a language in context; the harness has to supply the one the fixture is written in. */
const ScopedCapitalConditionsPanel = (props: Omit<Parameters<typeof CapitalConditionsPanel>[0], 'onRefresh'> & { onRefresh?: () => void }): React.ReactElement =>
  createElement(ShellLanguageProvider, { language: props.text === englishCapitalConditions ? 'en-US' : 'zh-CN' },
    createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CapitalConditionsPanel, { onRefresh: () => undefined, ...props })))

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
    const state = { ...fullState(), etf: 'unavailable' as const }
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
        etf: {
          state: 'available',
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
      state: { state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%' }
    })))
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))

    expect(container.querySelector('[data-etf-flow="available"]')).not.toBeNull()
  })

  it.each(['zh-CN', 'en-US'] as const)('does not fabricate an observation time for the %s non-available states', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    for (const state of [{ state: 'loading' as const }, { state: 'empty' as const }, { state: 'unavailable' as const }]) {
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

  it('tells a failed read apart from an empty one, through the platform error state', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' } }))

    // "Could not read" is an error, never an empty: a panel that says "nothing here" when the
    // query failed tells the reader the opposite of what happened.
    expect(markup).toContain('data-state="error"')
    expect(markup).toContain('data-size="md"')
    expect(markup).not.toContain('data-state="empty"')
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
    // 陈述不是控件：牌位里没有按钮，也没有可展开的读数。
    const header = markup.slice(markup.indexOf('mi-capital-conditions__header-band'), markup.indexOf('</div>', markup.indexOf('mi-capital-conditions__header-band')))
    expect(header).not.toContain('<button')
    expect(markup).toMatch(new RegExp(`<h2>${text.title}</h2><span class="mi-capital-conditions__signal-statement"`))
  })

  it('draws no chip at all while the rule had nothing to say', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))
    expect(markup).not.toContain('mi-capital-conditions__signal')
  })

  it('opens the readings inside the card, keeps focus on the chip, and closes again', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const state = {
      ...fullState(),
      etfSignal: {
        state: 'alert' as const, asset: 'btc' as const, amountUsd: '$488.7M', cumulativeUsd: '-$488.7M',
        coveredDays: 3, requiredDays: 3, observedAt: '2026-10-30T00:00:00.000Z'
      }
    }

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state })))
    const chip = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__signal')!
    expect(chip.textContent).toBe('Three-day net outflow $488.7M')
    expect(chip.getAttribute('aria-label')).toBe('Three-day net outflow $488.7M, BTC')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(chip.getAttribute('aria-controls')).toBe('mi-capital-conditions-signal-detail')

    await act(async () => { chip.focus(); chip.click() })

    const detail = container.querySelector<HTMLElement>('#mi-capital-conditions-signal-detail')!
    const content = detail.textContent ?? ''
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    // 读数在卡片里展开，不盖住要对照的卡片与日流表。
    expect(detail.tagName).toBe('DL')
    expect(container.querySelector('.drawer__body')).toBeNull()
    expect(content).toContain(text.signalDetailRule)
    expect(content).toContain(text.signalRuleName)
    expect(content).toContain(text.signalRuleWindow)
    expect(content).toContain('-$488.7M')
    expect(content).toContain('3/3')
    expect(content).toContain('2026-10-30')
    expect(content).toContain(text.signalDetailNote)
    // 读者看得见的只有白话：规则名、模块名、原始码都不出现。
    expect(content).not.toContain('etf-outflow-3d')
    expect(content).not.toContain('etf-flows')
    // 焦点留在牌子上，再点收起。
    expect(document.activeElement).toBe(chip)
    await act(async () => chip.click())
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#mi-capital-conditions-signal-detail')).toBeNull()
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

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' }, onRefresh })))
    const action = container.querySelector<HTMLButtonElement>('.state-view__action')!
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

    const state = { ...fullState(), etf: 'unavailable' as const }
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state, onRefresh })))
    const actions = [...container.querySelectorAll<HTMLButtonElement>('.state-view__action')]
    expect(actions).toHaveLength(2)
    await act(async () => actions[0]!.click())
    await act(async () => actions[1]!.click())
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it.each(['zh-CN', 'en-US'] as const)('offers %s readers a re-collection action instead of another read while unavailable', async (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const onRefresh = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' }, onRefresh })))
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__refresh')!
    expect(button.textContent).toBe(text.refresh)
    await act(async () => button.click())
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

  it('reports a failed re-collection and blocks a second request while it runs', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' }, onRefresh: () => undefined, refreshFailed: true })))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(text.refreshFailed)

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
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: [] },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: [] }
    }
  }
}

function fullState() {
  const rows = Array.from({ length: 30 }, (_, index) => ({ tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`, direction: index === 29 ? 'zero' as const : 'inflow' as const, magnitudePercent: index === 29 ? 0 : index + 1 }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    // Mirrors the projection: it already cut the window to the last seven days before the panel sees it.
    flowHistory: { state: 'available' as const, rows: Array.from({ length: 30 }, (_, index) => ({ tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`, funds: (index - 10) * 1_000_000, btc: (index + 1) * 1_000_000, eth: -(index + 1) * 1_000_000 })).slice(-7) },
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: rows.map((row) => ({ ...row, direction: row.direction === 'zero' ? 'zero' as const : 'outflow' as const })) }
    }
  }
}

function streakState() {
  const btcRows = Array.from({ length: 5 }, (_, index) => ({
    tradingDate: `2026-08-${String(index + 26).padStart(2, '0')}`,
    direction: index < 2 ? 'outflow' as const : 'inflow' as const,
    magnitudePercent: index + 1
  }))
  const ethRows = btcRows.map((row) => ({ ...row, direction: 'outflow' as const }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(), verifiedAt: '2026-08-18T07:00:00.000Z',
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: btcRows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: ethRows }
    }
  }
}

function degradedState() {
  const state = fullState()
  state.etf.coverage = [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 12, complete: false }]
  state.etf.btc.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
  ]
  state.etf.eth.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
  ]
  return state
}

function completeCoverage() {
  return [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }]
}

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
