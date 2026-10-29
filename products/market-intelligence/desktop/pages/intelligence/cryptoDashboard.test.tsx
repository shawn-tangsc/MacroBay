// @vitest-environment happy-dom
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { AgentPortal } from './AgentPortal'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import type { DashboardFeedRowState } from './dashboardFeedStatusModel'
import { marketIntelligenceAgents } from './agentPortalModel'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

const page = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
const portal = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx'), 'utf8')
const dashboard = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/CryptoIntelligenceDashboard.tsx'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
/** The page stylesheet: it must not own the dashboard shell a second time. */
const pageStyles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
const asOf = '2026-08-05T00:00:00.000Z'
let root: Root | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

function classCount(markup: string, className: string): number {
  return [...markup.matchAll(new RegExp(`class=\"[^\"]*${className}[^\"]*\"`, 'g'))].length
}

/** The ✓ summary line as the strip prints it: the count and the healthy feeds' own names. */
function formatFeedStatusSummary(template: string, count: number, names: readonly string[]): string {
  return template.replace('{count}', String(count)).replace('{names}', names.join(' · '))
}

function cssBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  const blockStart = source.indexOf('{', markerIndex)
  if (markerIndex < 0 || blockStart < 0) return ''

  let depth = 0
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(blockStart + 1, index)
  }

  return ''
}

describe('crypto intelligence dashboard', () => {
  const text = productText['zh-CN'].pages.intelligence.portal

  it('removes static preview dependencies and leaves only real dashboard regions', () => {
    expect(page).not.toContain('cryptoDashboardPreview')
    expect(dashboard).not.toMatch(/CryptoDashboardPreview|cryptoMarketReadIds|cryptoCheckIds|market-read|judgment|macro-card|check-step|calendar-rule|staticPreview|notAdvice|__as-of|preview/)
    expect(styles).not.toMatch(/market-read|judgment|macro-card|check-step|calendar-rule|__caveat|__workspace|__sidebar/)
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const dashboardText = productText[locale].pages.intelligence.portal.dashboard
      // `AS OF` is only a defect as a baked-in date — the static preview printed `AS OF 2026-08-01
      // 18:05`. The rate rows legitimately print an observation date, and their English template says
      // `(as of {date})` with the date filled in at render time. The guard still catches any literal
      // `AS OF <year>` while allowing the template's placeholder.
      expect(JSON.stringify(dashboardText)).not.toMatch(/static preview|静态预览|not trading advice|不构成投资建议|AS OF\s*\d{4}|2026-08-01 18:05/i)
    }
  })


  it('accepts localized dashboard text for the real capital and independent positioning panel', () => {
    const markup = renderToStaticMarkup(
      createElement(CryptoIntelligenceDashboard, {
        onConfigureSources: () => undefined,
        onManageSource: () => undefined,
        onOpenCalendar: () => undefined,
                client: dashboardClient(),
        fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
        now: () => new Date(asOf),
        text: text.dashboard,
        onBack: () => undefined
      })
    )

    expect(markup).toContain(text.dashboard.positioning.title)
    // Three panel-owned rows, plus the 异常优先 feed strip: one ✓ summary line and one line per feed
    // that needs a look (the fixtures leave every feed without a readable reading).
    const sourceRows = [...markup.matchAll(/mi-crypto-dashboard__source-row/g)].length
    expect(sourceRows).toBe(3 + (markup.includes('data-feed-summary') ? 1 : 0) + [...markup.matchAll(/data-feed-anomaly=/g)].length)
    expect(markup).not.toContain('✓ 0 源正常')
    expect(markup).toContain(text.dashboard.fundingRate.title)
  })

  
  
  


  
  

  it('renders a textual half-gauge and independent BTC/ETH funding-history values', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient({
        state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient({
        state: 'available', asOf,
        btc: [{ observedAt: '2026-08-04T10:00:00.000Z', ratePercent: 0.01234 }],
        eth: [{ observedAt: '2026-08-04T11:00:00.000Z', ratePercent: -0.0031 }]
      }), now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined, onManageSource: () => undefined,
      onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    const row = container.querySelector('.mi-crypto-dashboard__positioning-row')!
    const gauge = row.querySelector('[data-sentiment-gauge]')!
    const rows = row.querySelectorAll('[data-funding-latest]')
    expect(gauge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(gauge.querySelectorAll('[data-gauge-segment]')).toHaveLength(5)
    expect(gauge.querySelector('.mi-crypto-dashboard__gauge-needle')?.getAttribute('data-gauge-bucket')).toBe('extreme-fear')
    expect(gauge.querySelector('[data-gauge-bucket-text]')?.getAttribute('data-gauge-bucket-text')).toBe('extreme-fear')
    expect(gauge.textContent).toContain('22')
    expect(gauge.textContent).toContain(text.dashboard.fearGreed.buckets['extreme-fear'])
    expect(gauge.textContent).toContain(text.dashboard.fearGreed.observedAt)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('+0.0123%')
    expect(rows[0]?.textContent).toContain(text.dashboard.fundingRate.paymentDirections['long-pays-short'])
    expect(rows[1]?.textContent).toContain('-0.0031%')
    expect(rows[1]?.textContent).toContain(text.dashboard.fundingRate.paymentDirections['short-pays-long'])
    expect(row.textContent).not.toMatch(/58|conclusion|classification|https?:|sourceUrl|evidence|profile|health|credential|error/i)
  })

  it('fails closed instead of crashing when a legacy funding client has no history query', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(),
      fundingRateClient: { querySnapshot: () => Promise.resolve({ state: 'empty' }) }, now: () => new Date(asOf),
      onBack: () => undefined, onConfigureSources: () => undefined, onManageSource: () => undefined,
      onOpenCalendar: () => undefined, text: text.dashboard
    } as never)))
    await flush()

    expect(container.querySelector('.mi-funding-rate-history')?.getAttribute('data-state')).toBe('unavailable')
  })

  it.each([
    ['loading', undefined, 'loading'],
    ['empty', { state: 'empty', asOf }, 'empty'],
    ['unavailable', { state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' }, 'unavailable'],
    ['asset-local empty', { state: 'available', asOf, btc: [], eth: [{ observedAt: '2026-08-04T10:00:00.000Z', ratePercent: 0.01234 }] }, 'available']
  ] as const)('renders the compact %s funding-history state without fabricating BTC or ETH', async (_name, result, state) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: result === undefined ? { query: () => new Promise<never>(() => undefined) } : fundingRateClient(result), now: () => new Date(asOf),
      onBack: () => undefined, onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    const card = container.querySelector('.mi-funding-rate-history')!
    expect(card.textContent).toContain(text.dashboard.fundingRate.pairTitle)
    if (state === 'available') {
      const rows = card.querySelectorAll('[data-funding-latest]')
      expect(rows[0]?.textContent).toContain(text.dashboard.fundingRate.empty)
      expect(rows[1]?.textContent).toContain('+0.0123%')
    } else expect(card.textContent).toContain(text.dashboard.fundingRate[state])
    expect(card.textContent).not.toMatch(/5\.8|\$42M|\$18M|\$330M|liquidation|open interest|crowded|https?:|sourceUrl|evidence|profile|health|credential|error/i)
  })


  it('sends Fear & Greed and Binance Futures Positioning management to their local drawer entries', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const manageSource = vi.fn()

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), now: () => new Date(asOf),
      onBack: () => undefined, onConfigureSources: () => undefined, onManageSource: manageSource, onOpenCalendar: () => undefined,
      text: text.dashboard
    })))
    await flush()
    const source = container.querySelector('.mi-crypto-dashboard__source-region')!
    await act(async () => findButton(source, text.dashboard.fearGreed.manageSettings).click())
    await act(async () => findButton(source, text.dashboard.fundingRate.manageSettings).click())

    expect(manageSource).toHaveBeenCalledTimes(2)
    expect(manageSource).toHaveBeenCalled()
  })

  // The macro-market source drives the 市场状态 gold row; the strip has to say what it can actually
  // read, and must never print 采集正常 over an empty store.
  const goldSourceCases: [DashboardFeedRowState, MacroMarketSnapshotView][] = [
    ['ok', { state: 'available', asOf, source: { enabled: true, hasCredential: true },
      readings: [{ seriesId: 'xau-usd', level: 3413.9, atMs: Date.parse(asOf), returns: {} }], caveats: [] }],
    ['awaiting-collection', { state: 'empty', asOf, source: { enabled: true, hasCredential: true }, readings: [], caveats: [] }],
    ['configured-disabled', { state: 'empty', asOf, source: { enabled: false, hasCredential: true }, readings: [], caveats: [] }],
    ['unconfigured', { state: 'empty', asOf, source: { enabled: true, hasCredential: false }, readings: [], caveats: [] }],
    ['unavailable', { state: 'unavailable' }]
  ]

  it.each(goldSourceCases)('states the gold feed as %s in the source-status strip', async (state, macro) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      macroMarketClient: { query: async () => macro }, now: () => new Date(asOf), onBack: () => undefined,
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    const row = container.querySelector('[data-feed-row="gold"]')
    if (state === 'ok') {
      // 异常优先: a healthy feed has no line of its own — it is named on the ✓ summary line instead.
      expect(row).toBeNull()
      expect(container.querySelector('[data-feed-summary]')!.textContent).toContain(text.dashboard.feedStatus.rowNames.gold)
      return
    }
    expect(row!.getAttribute('data-state')).toBe(state)
    expect(row!.textContent).toContain(text.dashboard.feedStatus.rowNames.gold)
    expect(row!.textContent).toContain(text.dashboard.feedStatus.states[state])
    // The guard: an empty store is never reported as a collecting source.
    if (macro.state !== 'available') expect(row!.getAttribute('data-state')).not.toBe('ok')
  })

  it('sends the gold feed to its Twelve Data drawer entry without a client', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const manageSource = vi.fn()

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: manageSource, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()
    const row = container.querySelector('[data-feed-row="gold"]')!
    expect(row.getAttribute('data-state')).toBe('unavailable')
    // 异常优先 keeps the link short: the row already names the feed, the button does not repeat it.
    await act(async () => findButton(row as HTMLElement, text.dashboard.feedStatus.manage).click())

    expect(manageSource).toHaveBeenCalled()
  })

  it('keeps a fallen-back dollar on its own line and folds the healthy feeds into the summary', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      macroMarketClient: { query: async () => ({ state: 'available', asOf, source: { enabled: true, hasCredential: true },
        readings: [{ seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(asOf), returns: {}, synthetic: true }], caveats: [] }) },
      macroRatesClient: { query: async () => ({ state: 'available', asOf, readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 4.12, period: '2026-09-12' }], caveats: [] }) },
      now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    const dollar = container.querySelector('[data-feed-row="dollar"]')!
    // Without the feed-status read the reason is unknown, but the fallback itself is still stated.
    expect(dollar.getAttribute('data-state')).toBe('stale-fallback')
    expect(dollar.textContent).toContain('合成值')
    expect(dollar.textContent).not.toContain(text.dashboard.feedStatus.states.ok)
    // 异常优先: the daily rate close is healthy, so it is counted on the summary line rather than queued
    // beside the anomaly. The observation date itself belongs to the rate row's own line, not the summary.
    expect(container.querySelector('[data-feed-row="rates"]')).toBeNull()
    const summary = container.querySelector('[data-feed-summary]')!
    const label = summary.querySelector('[data-feed-status="summary"]')!
    expect(label.textContent).toBe(formatFeedStatusSummary(text.dashboard.feedStatus.summary, 1, [text.dashboard.feedStatus.rowNames.rates]))
    expect(summary.textContent).not.toContain('2026-09-12')
  })

  it('prints one ✓ summary line, one link, and no anomaly line while every feed is healthy', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      macroMarketClient: { query: async () => ({ state: 'available', asOf, source: { enabled: true, hasCredential: true },
        readings: [{ seriesId: 'dxy-real', level: 98.21, atMs: Date.parse(asOf), returns: {} }, { seriesId: 'xau-usd', level: 3413.9, atMs: Date.parse(asOf), returns: {} }], caveats: [] }) },
      macroRatesClient: { query: async () => ({ state: 'available', asOf, readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 4.12, period: '2026-09-12' }], caveats: [] }) },
      crossAssetClient: { query: async () => ({ schemaVersion: 1, indexSource: 'real', lastClosed: { index: { at: asOf, close: 23_100 } } }) },
      now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    } as never)))
    await flush()

    const summaries = container.querySelectorAll('[data-feed-summary]')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.querySelector('[data-feed-status="summary"]')!.textContent).toBe(formatFeedStatusSummary(text.dashboard.feedStatus.summary, 4, [
      text.dashboard.feedStatus.rowNames.dollar, text.dashboard.feedStatus.rowNames.gold,
      text.dashboard.feedStatus.rowNames.rates, text.dashboard.feedStatus.rowNames.index
    ]))
    // One line means one link: no healthy feed carries a settings link of its own.
    expect(container.querySelectorAll('[data-feed-summary] button')).toHaveLength(1)
    expect(container.querySelector('[data-feed-summary] button')!.textContent).toBe(text.dashboard.feedStatus.manageSources)
    expect(container.querySelectorAll('[data-feed-anomaly]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-feed-row]')).toHaveLength(0)
  })

  it('gives each 需要留意 feed one line and the summary one, and never a zero-feed summary', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    // Every feed needs a look here, so the strip prints their lines and no ✓ 0 源正常 line at all.
    expect(container.querySelectorAll('[data-feed-anomaly]')).toHaveLength(4)
    expect(container.querySelector('[data-feed-summary]')).toBeNull()
    expect(container.textContent).not.toContain(text.dashboard.feedStatus.summary.replace('{count}', '0').split('（')[0]!)
  })

  it('prints a failed feed as its code, and drops anything URL- or key-shaped instead of repeating it', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      macroMarketClient: { query: async () => ({ state: 'available', asOf, source: { enabled: true, hasCredential: true },
        readings: [{ seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(asOf), returns: {}, synthetic: true }], caveats: [] }) },
      // The boundary already refuses such a payload, so this is the strip's own second lock: the code
      // reaches the line as a code only, and the provider's own words never do.
      dashboardFeedStatusClient: { query: async () => ({ state: 'available', sources: [{ sourceId: 'realmarketapi-market', enabled: true, hasCredential: true, failureCode: 'credential-rejected https://api.example.com/price?apikey=SECRET0123456789' }] }) },
      now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    } as never)))
    await flush()

    const dollar = container.querySelector('[data-feed-row="dollar"]')!
    expect(dollar.getAttribute('data-state')).toBe('failed')
    expect(dollar.textContent).toContain('credential-rejected')
    for (const fragment of ['http', 'api.example.com', 'apikey', 'SECRET']) expect(container.textContent).not.toContain(fragment)
    // A failure is never dressed up as 采集正常, and the fallback it is answering from is still stated.
    expect(dollar.textContent).not.toContain(text.dashboard.feedStatus.states.ok)
    expect(dollar.textContent).toContain('合成值')
  })

  it('contains no IPC, service, network, AI, or chart path', () => {
    const sources = [page, portal, dashboard].join('\n')
    // The two injected read-only clients are the only IPC these files may name; every other line
    // still has to stay free of transport, service and network paths.
    const injectedClientImports = ['../../shared/ipc/crossAssetObservationClient', '../../shared/ipc/dashboardFeedStatusClient', '../../shared/ipc/macroMarketSnapshotClient', '../../shared/ipc/macroRatesSnapshotClient']
    const withoutInjectedClients = sources.split('\n')
      .filter(line => !injectedClientImports.some(client => line.includes(client))).join('\n')

    expect(withoutInjectedClients).not.toMatch(/(?:shared\/ipc|service\/|\/service|intelligenceSourcesClient|window\.platform)/)
    expect(sources).not.toMatch(/\b(?:fetch|WebSocket|axios|ipcRenderer)\b/)
    expect(dashboard).not.toMatch(/(?:lightweight-charts|series)/i)
  })

  it('no longer ships the dead macro release strip anywhere in the repository', () => {
    // The strip had no call site; only its CSS was asserted. A source-level scan is the guard that
    // stops it being reintroduced as a second interpretation of the same calendar rows.
    const dataAttribute = 'data-release-' + 'dynamics'
    const className = 'mi-crypto-dashboard__' + 'release-dynamics'
    const offenders = repositorySourceFiles(process.cwd()).filter(file => {
      const source = readFileSync(file, 'utf8')
      return source.includes(dataAttribute) || source.includes(className)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the dashboard shell and its gutter ladder in one stylesheet', () => {
    // 壳、页边距与色板 token 只能有一个 owner。两份 `.mi-crypto-dashboard` 靠加载顺序决胜负时，被压住
    // 的那份连自己的 @media 阶梯一起失效 —— 2026-10-27 全屏仍换行，就是按失效值算出来的断点卡偏了 4px。
    expect(pageStyles).not.toMatch(/^\.mi-crypto-dashboard \{/m)
    expect(pageStyles).not.toContain('--mi-dashboard-page-inline')
    expect(pageStyles).not.toContain('--mi-dashboard-page-block')

    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    expect(dashboardRootRule).toContain('--mi-dashboard-page-inline: 32px')
    expect(dashboardRootRule).toContain('--mi-dashboard-page-block: 32px')
    expect(dashboardRootRule).toContain('padding: var(--mi-dashboard-page-block) var(--mi-dashboard-page-inline)')
    expect(dashboardRootRule).toContain('container-type: inline-size')

    // 阶梯两端成对移动：只缩 inline 会让数据带一头 32 一头 24。
    const ladder = styles.slice(styles.indexOf('@media (max-width: 1279px)'))
    expect(ladder).toContain('--mi-dashboard-page-inline: 24px; --mi-dashboard-page-block: 24px;')
    expect(ladder).toContain('--mi-dashboard-page-inline: 20px; --mi-dashboard-page-block: 20px;')
  })

  it('uses one capital data band and a second sentiment/funding row without unequal panel borders', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__capital-positioning-row {')
    const capitalRule = cssBlock(styles, '.mi-capital-conditions {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(rowRule).not.toContain('overflow-x: hidden')
    expect(dashboardRootRule).toContain('container-type: inline-size')
    expect(rowRule).toContain('border-top: 1px solid var(--mi-dashboard-line)')
    expect(rowRule).toContain('border-bottom: 1px solid var(--mi-dashboard-line)')
    // 资金面带只有一块：它自己不再是两列，并排发生在面板内部的 content-row。
    expect(rowRule).not.toContain('grid-template-columns')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-sentiment-allocation: 1fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-funding-allocation: 4fr')
    expect(stackStyles).toContain('.mi-crypto-dashboard__positioning-row { grid-template-columns: minmax(0, 1fr); gap: 16px; }')
    expect(capitalRule).not.toContain('border-radius')
    expect(capitalRule).not.toContain('border-top')
    expect(capitalRule).not.toContain('border-bottom')
    const fundingRule = cssBlock(styles, '.mi-crypto-dashboard__positioning-row > .mi-funding-rate-history {')
    expect(fundingRule).toContain('padding-left: var(--mi-dashboard-band-zone-inline)')
    expect(fundingRule).toContain('border-left: 1px solid var(--mi-dashboard-line)')
    expect(styles).not.toContain('mi-crypto-dashboard__capital-positioning-row .mi-crypto-dashboard__state-card')
    expect(styles).toContain('mi-capital-conditions__etf-table')
  })

  it('keeps the sentiment zone compact and stacks the funding-history panel at narrow widths', () => {
    const sentimentRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(sentimentRule).toContain('container-type: inline-size')
    expect(sentimentRule).toContain('container-name: mi-sentiment-positioning')
    expect(stackStyles).toContain('.mi-crypto-dashboard__sentiment,')
    expect(stackStyles).toContain('.mi-crypto-dashboard__positioning-row > .mi-funding-rate-history')
  })

  it('uses named compact rhythm inside the real data bands', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__capital-positioning-row {')
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    const stableRule = cssBlock(styles, '.mi-capital-conditions__etf-col-asset {')
    const gaugeRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment-gauge {')

    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-row-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-column-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-band-zone-inline')
    expect(rowRule).toContain('padding: var(--mi-dashboard-band-block-padding) 0')
    expect(headerBandRule).toContain('flex-wrap: wrap')
    expect(headerBandRule).toContain('gap: var(--mi-dashboard-capital-header-row-gap) var(--mi-dashboard-capital-header-column-gap)')
    expect(stableRule).toContain('width: 26%')
    expect(gaugeRule).toContain('padding: var(--mi-dashboard-gauge-block-padding)')
  })

  it('puts the stablecoin and fixed-layout ETF tables in the first band', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const capitalRule = cssBlock(styles, '.mi-capital-conditions {')
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    const stableRule = cssBlock(styles, '.mi-capital-conditions__etf-col-asset {')
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const contentRowRule = cssBlock(styles, '.mi-capital-conditions__content-row {')

    expect(capitalRule).toContain('align-content: start')
    expect(capitalRule).toContain('row-gap: var(--mi-dashboard-capital-content-row-gap)')
    expect(contentRowRule).toContain('grid-template-columns: minmax(240px, var(--mi-dashboard-capital-summary-allocation)) minmax(0, var(--mi-dashboard-market-flow-allocation))')
    expect(dashboardRootRule).toContain('--mi-dashboard-capital-summary-allocation: 10fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-market-flow-allocation: 15fr')
    expect(stableRule).toContain('width: 26%')
    expect(tableRule).toContain('table-layout: fixed')
    expect(tableRule).toContain('width: 100%')
    expect(headerBandRule).toContain('min-width: 0')
  })

  it('keeps the unified three-series flow chart beside and as tall as the summary', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const etfRule = cssBlock(styles, '.mi-capital-conditions__etf-flow {')
    const barsRule = cssBlock(styles, '.mi-capital-conditions__chart {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(dashboardRootRule).toContain('--mi-dashboard-etf-flow')
    expect(etfRule).toContain('align-self: stretch')
    expect(etfRule).toContain('grid-template-rows: auto auto minmax(var(--mi-dashboard-etf-flow-chart-height), 1fr)')
    expect(etfRule).toContain('margin-right: var(--mi-dashboard-band-zone-inline)')
    expect(barsRule).toContain('min-height: var(--mi-dashboard-etf-flow-chart-height)')
    expect(barsRule).toContain('linear-gradient')
    expect(stackStyles).toContain('.mi-capital-conditions__etf-flow { margin-right: 0; }')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row')
  })

  it('reserves a real streak column and a caution coverage label in the ETF table', () => {
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const streakRule = cssBlock(styles, '.mi-capital-conditions__etf-table tbody td.mi-capital-conditions__streak {')
    const coverageRule = cssBlock(styles, '.mi-capital-conditions__coverage {')

    expect(tableRule).toContain('table-layout: fixed')
    expect(streakRule).toContain('font-size: 10px')
    expect(coverageRule).toContain('color: var(--mi-dashboard-caution)')
    expect(coverageRule).toContain('font-size: 9px')
  })

  it('uses a chart-forward split and a horizontal source status bar', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const sourceRule = cssBlock(styles, '.mi-crypto-dashboard__source-region {')
    const sourceRowRule = cssBlock(styles, '.mi-crypto-dashboard__source-row {')

    expect(dashboardRootRule).toContain('--mi-dashboard-capital-summary-allocation: 10fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-market-flow-allocation: 15fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-sentiment-allocation: 1fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-funding-allocation: 4fr')
    expect(sourceRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(sourceRowRule).toContain('display: flex')
    expect(sourceRowRule).not.toContain('grid-template-columns')
    expect(sourceRowRule).toContain('justify-content: start')
    expect(sourceRowRule).toContain('gap: var(--mi-dashboard-source-row-gap)')
    expect(dashboardRootRule).toContain('--mi-dashboard-source-row-gap: 8px')
    expect(styles).toContain('flex: 0 1 auto')
    expect(styles).toContain('flex: 0 0 auto')
    expect(styles).toContain('white-space: nowrap')
  })

  it('dots a feed row by the health policy, caution by default and positive only when healthy', () => {
    const blocks = styles.split('}').filter(block => block.includes('[data-feed-row]'))
    // The dot follows the health policy: 需要留意 is the base rule, so a state the policy has not
    // classified yet keeps the caution dot; a healthy row is the only one that earns the positive dot.
    expect(blocks.some(block => block.includes('[data-state]') && block.includes('var(--mi-dashboard-caution)'))).toBe(true)
    expect(blocks.some(block => block.includes("[data-feed-health='healthy']") && block.includes('var(--mi-dashboard-positive)'))).toBe(true)
    expect(blocks.some(block => block.includes("[data-feed-health='needs-attention']") && block.includes('var(--mi-dashboard-caution)'))).toBe(true)
    // Nothing here introduces a colour outside the dashboard's tokens.
    for (const block of blocks) {
      for (const value of block.match(/background:\s*[^;]+/g) ?? []) expect(value).toContain('var(--mi-dashboard-')
      for (const value of block.match(/(?:^|\s)color:\s*[^;]+/g) ?? []) expect(value).toContain('var(--mi-dashboard-')
    }
  })

  it('lets the ETF table shrink without losing the chart axis', () => {
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const chartRule = cssBlock(styles, '.mi-capital-conditions__chart {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(tableRule).toContain('width: 100%')
    expect(chartRule).toContain('min-width: 0')
    // 堆叠分支只把两列并成一列，表格列宽不变。
    expect(stackStyles).not.toContain('.mi-capital-conditions__etf-table')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row')
  })

  it('lays the two data bands out side by side by ratio, and stacks only where they cannot fit', () => {
    const contentRowRule = cssBlock(styles, '.mi-capital-conditions__content-row {')
    const positioningRule = cssBlock(styles, '.mi-crypto-dashboard__positioning-row {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(contentRowRule).toContain('grid-template-columns: minmax(240px, var(--mi-dashboard-capital-summary-allocation)) minmax(0, var(--mi-dashboard-market-flow-allocation))')
    expect(positioningRule).toContain('grid-template-columns: minmax(190px, var(--mi-dashboard-positioning-sentiment-allocation)) minmax(0, var(--mi-dashboard-positioning-funding-allocation))')
    // 并排不再挂在"内容宽 ≥ 1176px"的闸门上：那道闸门在 16 寸全屏上差 4px 就整块塌掉。
    expect(styles).not.toContain('@container (min-width: 1176px)')
    expect(stackStyles).toContain('.mi-crypto-dashboard__positioning-row { grid-template-columns: minmax(0, 1fr); gap: 16px; }')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row { grid-template-columns: minmax(0, 1fr); }')
    expect(stackStyles).toContain('.mi-crypto-dashboard__source-region { grid-template-columns: minmax(0, 1fr); }')
  })

  it('reaches its side-by-side bands in a full-screen laptop pane', () => {
    // 2026-10-27「全屏仍换行」的回归守卫。四段宽度各有 owner：侧栏在 shell 的 styles.css、Agent 栏在
    // marketAnalysisWorkspace.css、页边距与堆叠闸门在 cryptoDashboard.css。这里把它们读出来现算，
    // 而不是抄一个"应该够了"的结论 —— 任何人挪动其中任何一个，这条会先响。
    const shellStyles = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const workspaceStyles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
    const sidebar = Number(/--sidebar-width:\s*(\d+)px/.exec(shellStyles)?.[1])
    const paneLimit = /--mi-agent-pane-width:\s*clamp\(\s*(\d+)px,\s*([\d.]+)cqw,\s*(\d+)px\s*\)/.exec(workspaceStyles)
    const pageInline = Number(/--mi-dashboard-page-inline:\s*(\d+)px/.exec(cssBlock(styles, '.mi-crypto-dashboard {'))?.[1])
    const stackBelow = Number(/@container \(max-width: (\d+)px\)/.exec(styles)?.[1])

    expect(paneLimit, 'Agent 栏宽度必须是有上下限的比例值').not.toBeNull()
    expect(sidebar).toBeGreaterThan(0)
    expect(pageInline).toBeGreaterThan(0)
    expect(stackBelow).toBeGreaterThan(0)

    const paneMin = Number(paneLimit![1])
    const paneShare = Number(paneLimit![2])
    const paneMax = Number(paneLimit![3])
    const agentFor = (page: number): number => Math.min(Math.max(paneMin, (page * paneShare) / 100), paneMax)
    // 页边距阶梯：窗口 ≤1279 时是 24px，否则是基础值。
    const gutterFor = (page: number): number => (page + sidebar <= 1279 ? 24 : pageInline)
    const contentWidth = (page: number, panes: 'single' | 'split'): number =>
      page - (panes === 'split' ? agentFor(page) : 0) - gutterFor(page) * 2

    // 14 英寸 (1512) 与 16 英寸 (1728) 的 Mac 全屏，两种都必须能并排。
    for (const windowWidth of [1512, 1728]) {
      expect(contentWidth(windowWidth - sidebar, 'split'), `${windowWidth}px 窗口的看板内容盒`).toBeGreaterThan(stackBelow)
    }

    // 单栏切换点两侧必须是同一种数据带形态：否则跨过切换点，Agent 栏出现的同时数据带也塌成单列，
    // 版面一次跳两下。切换点取"看板并排还成立"的最小内容宽：900 + 边距 64 + Agent 下限 340。
    const compactAt = Number(/@container mi-analysis-dashboard \(max-width: (\d+)px\)/.exec(workspaceStyles)?.[1])
    expect(compactAt).toBeGreaterThan(0)
    expect(contentWidth(compactAt, 'single'), '切换点以下（单栏）').toBeGreaterThanOrEqual(stackBelow)
    expect(contentWidth(compactAt + 1, 'split'), '切换点以上（双栏）').toBeGreaterThanOrEqual(stackBelow)
  })

  it('renders capital in the first data band and sentiment/funding in the second', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      capitalConditionsClient: capitalConditionsClient(), now: () => new Date(asOf), onBack: () => undefined, onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: productText['en-US'].pages.intelligence.portal.dashboard
    } as never)))
    await flush()
    const row = container.querySelector<HTMLElement>('.mi-crypto-dashboard__capital-positioning-row')!
    const capital = row.querySelector<HTMLElement>('.mi-capital-conditions')!
    expect([...row.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions'])
    const positioning = container.querySelector<HTMLElement>('.mi-crypto-dashboard__positioning-row')!
    expect([...positioning.children].map((child) => child.className || child.tagName)).toEqual(['mi-crypto-dashboard__sentiment', 'mi-funding-rate-history'])
    expect([...capital.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions__content-row'])
    expect([...capital.firstElementChild!.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions__summary', 'mi-capital-conditions__etf-flow'])
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    expect(headerBandRule).toContain('display: flex')
    expect(headerBandRule).toContain('flex-wrap: wrap')
    expect(headerBandRule).toContain('min-width: 0')
  })

  it('renders the gauge as five fear-to-greed color segments with a matching bucket needle', () => {
    expect(styles).toContain('--mi-dashboard-sentiment-extreme-fear')
    expect(styles).toContain('--mi-dashboard-sentiment-fear')
    expect(styles).toContain('--mi-dashboard-sentiment-neutral')
    expect(styles).toContain('--mi-dashboard-sentiment-greed')
    expect(styles).toContain('--mi-dashboard-sentiment-extreme-greed')
    expect(styles).toContain("[data-gauge-bucket='extreme-fear']")
    expect(styles).toContain("[data-gauge-bucket='extreme-greed']")
    expect(styles).toContain("[data-gauge-bucket-text='extreme-fear']")
    expect(styles).toContain("[data-gauge-bucket-text='extreme-greed']")
  })

  it('keeps the funding-history component isolated from dashboard layout styles', () => {
    expect(styles).not.toContain('.mi-funding-rate-history__chart')
    expect(styles).not.toContain('.mi-crypto-dashboard__funding-rates')
  })

  it('keeps the dashboard root constrained so its lower checklist sections can scroll inside the product host', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')

    expect(dashboardRootRule).toContain('height: 100%')
    expect(dashboardRootRule).toContain('min-height: 0')
    expect(dashboardRootRule).toContain('overflow-y: auto')
    expect(dashboardRootRule).toContain('overflow-x: hidden')
    expect(dashboardRootRule).not.toContain('min-height: 100%')
  })
})

/**
 * Every text source file in the checkout, excluding build output and the private docs.
 *
 * The check is deliberately repository-wide: the strip was once a design-mandated surface, so a
 * future reintroduction would most likely start in a page or stylesheet outside this folder.
 */
function repositorySourceFiles(root: string, directory = root): string[] {
  const skippedDirectories = new Set(['node_modules', '.git', 'out', 'dist', 'build', 'coverage', 'release', 'docs-private'])
  const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.html'])
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith('.') || skippedDirectories.has(entry)) continue
    const path = join(directory, entry)
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) files.push(...repositorySourceFiles(root, path))
    else if (sourceExtensions.has(entry.slice(entry.lastIndexOf('.'))) && stats.size < 2_000_000) files.push(path)
  }
  return files
}

function dashboardClient(events: unknown[] = []) {
  return { queryMonth: async () => ({ state: 'available' as const, asOf, events }) }
}

function dashboardClientByMonth(eventsByMonth: Record<string, unknown[]>) {
  return { queryMonth: async ({ month }: { month: string }) => ({ state: 'available' as const, asOf, events: eventsByMonth[month] ?? [] }) }
}

function fearGreedClient(result: unknown = { state: 'empty' as const, asOf }) {
  return { querySnapshot: async () => result }
}

function fundingRateClient(result: unknown = { state: 'empty' as const, asOf }) {
  return { query: async () => result }
}

function capitalConditionsClient(result: unknown = {
  state: 'available' as const, asOf, etf: { state: 'unavailable' as const }, conclusion: 'partial' as const,
  coreStablecoins: { observedAt: '2026-08-04T23:00:00.000Z', verifiedAt: asOf, currentUsd: 254_900_000_000, change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323, change30dUsd: -500_000_000, change30dPercent: -0.21 }
}) {
  return { querySnapshot: vi.fn(async () => result) }
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((entry) => entry.textContent === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: [],
    ...overrides
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
