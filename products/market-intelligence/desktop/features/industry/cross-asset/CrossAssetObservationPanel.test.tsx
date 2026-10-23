// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { parseCrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import { createCrossAssetSnapshotQuery } from '../../../../service/intelligence/cross-asset/crossAssetSnapshotQuery'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const ScopedCrossAssetObservationPanel = (props: Parameters<typeof CrossAssetObservationPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CrossAssetObservationPanel, props))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The real daily closes: 5.24 after 5.22 on 10-09 (+2bp), 2.91 after 2.87 (+4bp), 2Y 4.80, breakeven 2.33. */
function ratesView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'available', asOf: '2026-10-14T12:00:00.000Z', caveats: ['official-daily-close'],
    readings: [
      { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09' },
      { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.91, previous: 2.87, period: '2026-10-09' },
      { seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, previous: 4.72, period: '2026-10-09' },
      { seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.33, period: '2026-10-13' }
    ],
    ...overrides
  }
}

describe('cross-asset observation workspace', () => {
  it('keeps the status table a table: a class name that already means `display: flex` cost a day', async () => {
    const css = readFileSync('products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css', 'utf8')
    const panel = readFileSync('products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.tsx', 'utf8')
    // `mi-cross-asset__status` is the quote-status line above and is declared `display: flex`. A
    // table wearing that class is not a table: its header and body become two anonymous tables with
    // independent column widths, so the figures never line up with their headings.
    expect(panel).toContain('className="mi-cross-asset__status-table"')
    expect(panel).not.toMatch(/<table className="mi-cross-asset__status"/)
    // The table's own rule must not set `display` at all: `table-layout: fixed` only means
    // something to a table, and one stray `display: flex` silently splits header from body.
    const tableRule = css.match(/\.mi-cross-asset__status-table\s*\{([^}]*)\}/)
    expect(tableRule?.[1] ?? '').not.toMatch(/display\s*:/)
    expect(tableRule?.[1] ?? '').toMatch(/table-layout:\s*fixed/)
    expect(css).toMatch(/\.mi-cross-asset__status-table \.mi-cross-asset__status-col\s*\{\s*width:\s*30%/)
    // Six columns now (name, level, four windows): the level column has its own bounded width, each
    // window column an explicit share, and a hairline divides the figures so four two-decimal
    // percentages cannot run together into one string.
    expect(css).toMatch(/\.mi-cross-asset__status-table \.mi-cross-asset__status-col-latest\s*\{\s*width:\s*16%/)
    expect(css).toMatch(/\.mi-cross-asset__status-table \.mi-cross-asset__status-col-window\s*\{\s*width:\s*13\.5%/)
    expect(css).toContain(".mi-cross-asset__status-table thead th + th, .mi-cross-asset__status-table tbody td + td { border-left: 1px solid")
    expect(css).toMatch(/\.mi-cross-asset__status-table tbody td \{[^}]*font-size: 9\.5px/)
    expect(css).toMatch(/\.mi-cross-asset__status-table th, \.mi-cross-asset__status-table td \{ padding: 3px 2px/)
  })

  it('prints the inputs it does not have as missing, with no figure anywhere in those rows', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const now = Date.parse('2026-09-14T12:00:00.000Z')
    const snapshot = createCrossAssetSnapshotQuery({ now: () => now, store: { revision: 0, queryAt: () => [] },
      live: () => ({ state: 'limited', quotes: { index: { state: 'stale', price: '712.30', tradedAtMs: now, receivedAtMs: now }, btc: { state: 'missing' }, eth: { state: 'missing' } } }) }).query({ range: '24h' })
    const client = { acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }), query: async () => snapshot, release: vi.fn(async () => ({ state: 'released' })) }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      const rows = [...host.querySelectorAll<HTMLTableRowElement>('[data-status-row]')]
      // The whole reading order, macro drivers first: the block states its own coverage instead of
      // leaving the reader to wonder why the dollar is absent.
      // Intraday rows first, then the daily block: the two answer questions at different speeds and the
      // table now keeps them apart, with the daily block stating its own frequency.
      expect(rows.map(row => row.dataset.statusRow)).toEqual(['dxy', 'gold', 'index', 'btc', 'eth', 'us10y', 'realRate'])
      // The index row has no reading here either: with no stored bar from either leg it says 未接入
      // rather than showing the number a row with data would show.
      const missing = rows.filter(row => row.dataset.connected === 'false')
      expect(missing.map(row => row.dataset.statusRow)).toEqual(['dxy', 'gold', 'index', 'us10y', 'realRate'])
      // The daily section announces itself instead of borrowing the window headings above it.
      expect(host.querySelector('[data-status-section="daily"] .mi-cross-asset__section')?.textContent)
        .toBe(`${text.dailyFrequency}${text.dailyCadence}`)
      for (const row of missing) {
        // The honesty guard, stated structurally: a planned row has no price and no return cell at
        // all, and its one value cell names the gap instead of filling it. A label may contain a
        // digit ("美债 10Y"); a figure may not appear.
        expect(row.querySelectorAll('[data-asset-price], [data-asset-return]')).toHaveLength(0)
        const value = row.querySelector('.mi-cross-asset__not-connected')
        expect(value?.textContent).toContain(text.notConnected)
        expect(value?.textContent).not.toMatch(/[0-9]/)
      }
      for (const row of rows.filter(row => row.dataset.connected === 'true')) expect(row.textContent).toMatch(/[0-9]|—/)
    } finally { await act(async () => root.unmount()) }
  })

  // The dashboard's 市场状态 block reads the macro snapshot: the dollar is the product's own
  // synthesis and says so, gold is a licensed level, and the two rate rows still have no source.
  it('shows the collected dollar and gold readings, labelling the computed dollar index', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const asOf = '2026-09-14T12:00:00.000Z'
    const macro = { state: 'available', asOf, source: { enabled: true, hasCredential: true }, readings: [
      { seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(asOf), returns: { '15m': 0.12, '1h': 0.34, '24h': 0.78, '7d': 0.56 }, synthetic: true },
      { seriesId: 'xau-usd', level: 3412.55, atMs: Date.parse(asOf), returns: { '15m': 0.05, '1h': 0.15, '24h': -0.4 } }
    ], caveats: ['synthetic-dollar-index', 'provider-time-series'] }
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, macroSnapshot: macro as never, text })))
      expect(host.querySelector('[data-status-row="dxy"][data-connected="true"]')).not.toBeNull()
      expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('101.42')
      expect(host.querySelector('[data-asset-return="dxy:15m"]')?.textContent).toBe('+0.12%')
      expect(host.querySelector('[data-asset-return="dxy:7d"]')?.textContent).toBe('+0.56%')
      // The synthetic label rides with the level and carries the caveat the wire published.
      const tag = host.querySelector('[data-synthetic="dxy"]')
      expect(tag?.textContent).toBe(text.syntheticTag)
      expect(tag?.getAttribute('title')).toBe(text.syntheticCaveat)
      expect(tag?.getAttribute('data-caveat')).toBe('synthetic-dollar-index')
      expect(host.querySelector('[data-status-row="gold"][data-connected="true"]')).not.toBeNull()
      expect(host.querySelector('[data-asset-price="gold"]')?.textContent).toBe('3412.55')
      // 7d was not in the gold reading: the cell is a dash whose title still says 无数据, not a zero.
      const missing = host.querySelector('[data-asset-return="gold:7d"]')
      expect(missing?.textContent).toBe(text.windowNoData)
      expect(missing?.getAttribute('title')).toBe(text.noData)
      expect(missing?.getAttribute('data-unavailable')).toBe('true')
      expect(host.querySelector('[data-asset-return="dxy:15m"]')?.getAttribute('data-unavailable')).toBeNull()
      expect(host.querySelector('[data-status-row="gold"] [data-synthetic]')).toBeNull()
      for (const id of ['us10y', 'realRate']) expect(host.querySelector(`[data-status-row="${id}"][data-connected="false"]`)).not.toBeNull()
      const headers = [...host.querySelectorAll('.mi-cross-asset__status-table thead th')].map(th => th.textContent)
      expect(headers).toEqual([text.statusColumns.asset, text.statusColumns.latest, '15m', '1h', '24h', '7d'])
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it.each([
    ['empty', { state: 'empty', asOf: '2026-09-14T12:00:00.000Z', source: { enabled: true, hasCredential: true }, readings: [], caveats: [] }],
    ['unavailable', { state: 'unavailable' }]
  ])('keeps both macro rows unconnected and figureless when the snapshot is %s', async (_label, macro) => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, macroSnapshot: macro as never, text })))
      for (const id of ['dxy', 'gold']) {
        const row = host.querySelector(`[data-status-row="${id}"][data-connected="false"]`)
        expect(row).not.toBeNull()
        // No level, no window cell and no synthetic label: a row without data states the gap.
        expect(row!.querySelectorAll('[data-asset-price], [data-asset-return], [data-synthetic]')).toHaveLength(0)
        const cell = row!.querySelector('.mi-cross-asset__not-connected')
        expect(cell?.textContent).toContain(text.notConnected)
        expect(cell?.textContent).not.toMatch(/[0-9]/)
      }
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps both macro rows unconnected and figureless when no macro snapshot is supplied at all', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      for (const id of ['dxy', 'gold']) {
        const row = host.querySelector(`[data-status-row="${id}"][data-connected="false"]`)
        expect(row).not.toBeNull()
        expect(row!.querySelectorAll('[data-asset-price], [data-asset-return], [data-synthetic]')).toHaveLength(0)
      }
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('preserves the admitted display precision and exposes source and each asset status', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const now = Date.parse('2026-09-14T12:00:00.000Z')
    // The licensed index leg has no history in this fixture, so the row is answered by the tokenised
    // proxy — which is the only leg that carries a live trade, and the one this test reads.
    const proxyBars = Array.from({ length: 289 }, (_, index) => ({
      symbol: 'QQQUSDT', barOpenMs: now - (289 - index) * 300_000, barEndMs: now - (288 - index) * 300_000,
      open: '700', high: '720', low: '690', close: String(700 + index / 100), volume: '1'
    }))
    const snapshot = createCrossAssetSnapshotQuery({ now: () => now,
      store: { revision: 0, queryAt: input => input.symbol === 'QQQUSDT' ? proxyBars.filter(bar => bar.barEndMs <= input.asOfMs) : [] },
      live: () => ({ state: 'limited', quotes: { index: { state: 'stale', price: '712.30', tradedAtMs: now, receivedAtMs: now }, btc: { state: 'missing' }, eth: { state: 'missing' } } }) }).query({ range: '24h' })
    const client = { acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }), query: async () => snapshot, release: vi.fn(async () => ({ state: 'released' })) }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      expect(host.querySelector('[data-asset-price="index"]')?.textContent).toBe('712.30')
      expect(host.querySelector('[data-status-row="index"]')?.getAttribute('data-index-source')).toBe('proxy')
      expect(host.querySelector('[data-index-proxy="true"]')?.textContent).toBe(text.proxyTag)
      expect(host.querySelector('[data-source-state="limited"]')?.textContent).toBe(text.states.limited)
      for (const asset of ['index', 'btc', 'eth']) expect(host.querySelector(`[data-status-row="${asset}"][data-connected="true"]`)).not.toBeNull()
      expect(host.querySelector('.mi-cross-asset > header, .mi-cross-asset > footer')).toBeNull()
      const proxyInfo = host.querySelector<HTMLButtonElement>('.mi-cross-asset__quote button[aria-label]')
      expect(proxyInfo?.getAttribute('aria-label')).toBe(text.subtitle)
      const toolbar = host.querySelector('.mi-cross-asset__chart-toolbar')!
      const refresh = toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${text.refresh}"]`)
      expect(refresh).not.toBeNull()
      expect(refresh?.textContent).toBe('')
      const info = toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${text.analysis}"]`)!
      expect(info).not.toBeNull()
      await act(async () => { info.click() })
      await vi.waitFor(() => {
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(text.coverage)
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('2026-09-14 12:00:00 GMT')
      })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it.each(['zh-CN', 'en-US'] as const)('has no duplicate configuration summary or entry while preserving the observation workspace in %s', async language => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText[language].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }),
      release: vi.fn(), getSourceConfiguration: async () => ({ state: 'configured', enabled: false }) }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      expect(host.querySelector('[data-cross-asset-workspace]')).not.toBeNull()
      expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(text.title)
      expect(host.textContent).toContain(text.unavailable)
      expect(host.querySelector('[data-cross-asset-region="status"]')).not.toBeNull()
      // 跨市场观察 is temporarily unrendered (its data and i18n keys are untouched); this guard is
      // flipped back when the aside returns.
      expect(host.querySelector('[data-cross-asset-region="observations"]')).toBeNull()
      const removedCopy = language === 'zh-CN' ? ['管理配置', '测试接口', '已配置', '使用默认配置', '配置状态未知'] : ['Manage source', 'Test interface', 'Configured', 'Default configuration', 'Configuration unknown']
      for (const label of removedCopy) expect(host.textContent).not.toContain(label)
      expect([...host.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === text.refresh)).toBe(true)
      expect(host.querySelector('input[type="password"], input[type="text"]')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('shows the gold live price with its badge, and no badge at all when there is no live tick', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const asOf = '2026-09-14T12:00:00.000Z'
    const atMs = Date.parse(asOf)
    const macro = (live?: unknown) => ({
      state: 'available', asOf, source: { enabled: true, hasCredential: true }, caveats: ['synthetic-dollar-index', 'provider-time-series'],
      readings: [
        { seriesId: 'dxy-synthetic', level: 101.42, atMs, returns: { '15m': 0.12, '1h': 0.34 }, synthetic: true },
        { seriesId: 'xau-usd', level: 3412.55, atMs, returns: { '15m': 0.05, '1h': 0.15, '4h': 0.2, '24h': -0.4 }, ...(live === undefined ? {} : { live }) }
      ]
    })
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, macroSnapshot: macro({ state: 'live', price: '3413.90', atMs: atMs + 5_000 }) as never, text })))
      // The 最新 cell shows the stream price alone; the freshness tag rides with the asset name, the
      // way the synthetic tag does, rather than qualifying the figure it sits behind.
      const price = host.querySelector('[data-asset-price="gold"]')!
      expect(price.textContent).toContain('3413.90')
      expect(host.querySelector('[data-asset-price="gold"] [data-live-state]')).toBeNull()
      const badge = host.querySelector('[data-status-row="gold"] th [data-live-state]')!
      expect(badge.getAttribute('data-live-state')).toBe('live')
      expect(badge.textContent).toBe(text.liveStateLabels.live)
      expect(badge.getAttribute('title')).toContain(text.liveHint)
      expect(badge.getAttribute('data-live-observed')).toBe(String(atMs + 5_000))
      // The four windows are still the closed-bar figures: the live tick moved none of them.
      expect(host.querySelector('[data-asset-return="gold:15m"]')?.textContent).toBe('+0.05%')
      expect(host.querySelector('[data-asset-return="gold:24h"]')?.textContent).toBe('−0.40%')
      // The dollar row carries no live badge, even though it is the other connected macro row.
      expect(host.querySelector('[data-status-row="dxy"] [data-live-state]')).toBeNull()

      // A delayed tick keeps the badge, with the delayed wording rather than a live claim.
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, macroSnapshot: macro({ state: 'stale', price: '3413.90', atMs }) as never, text })))
      expect(host.querySelector('[data-status-row="gold"] th [data-live-state]')?.textContent).toBe(text.liveStateLabels.stale)

      // No live field: the cell falls back to the stored level, with no badge and no invented figure.
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, macroSnapshot: macro() as never, text })))
      const stored = host.querySelector('[data-asset-price="gold"]')!
      expect(stored.textContent).toBe('3412.55')
      expect(stored.querySelector('[data-live-state]')).toBeNull()
      expect(stored.textContent).not.toContain('3413.90')
      expect(host.querySelector('[data-status-row="gold"][data-connected="true"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the live badge and the four closed windows side by side in both languages', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const asOf = '2026-09-14T12:00:00.000Z'
    const atMs = Date.parse(asOf)
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      for (const language of ['zh-CN', 'en-US'] as const) {
        const text = productText[language].pages.intelligence.portal.dashboard.crossAsset
        const macro = {
          state: 'available', asOf, source: { enabled: true, hasCredential: true }, caveats: [],
          readings: [{ seriesId: 'xau-usd', level: 3412.55, atMs, returns: {}, live: { state: 'live' as const, price: '3413.90', atMs } }]
        }
        await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, macroSnapshot: macro as never, text })))
        const badge = host.querySelector('[data-live-state]')!
        expect(badge.textContent).toBe(text.liveStateLabels.live)
        expect(badge.textContent?.length).toBeGreaterThan(0)
        // Every window the store could not answer stays a dash: a live price never fills a hole.
        for (const window of ['15m', '1h', '24h', '7d']) {
          expect(host.querySelector(`[data-asset-return="gold:${window}"]`)?.textContent).toBe(text.windowNoData)
        }
      }
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('prints the official daily closes with basis-point changes in one merged cell per rate row', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, rates: ratesView() as never, text })))

      expect(host.querySelector('[data-status-row="us10y"][data-connected="true"]')).not.toBeNull()
      expect(host.querySelector('[data-status-row="realRate"][data-connected="true"]')).not.toBeNull()
      // 最新: two decimals and a percent sign, whatever the provider sent.
      expect(host.querySelector('[data-asset-price="us10y"]')?.textContent).toBe('5.24%')
      expect(host.querySelector('[data-asset-price="realRate"]')?.textContent).toBe('2.91%')
      // The four intraday columns are replaced by one daily cell: a bp change with its observation date.
      const daily = host.querySelector<HTMLTableCellElement>('[data-asset-daily="us10y"]')
      expect(daily?.colSpan).toBe(4)
      expect(daily?.textContent).toContain('日频 +2bp（截至 2026-10-09）')
      expect(host.querySelector('[data-asset-daily="realRate"]')?.textContent).toContain('日频 +4bp（截至 2026-10-09）')
      // No window cell survives on these rows: a daily close is not a 15m return.
      for (const id of ['us10y', 'realRate']) {
        expect(host.querySelector(`[data-status-row="${id}"] [data-asset-return]`)).toBeNull()
      }
      // The optional extras ride in the same cell, as small text and as the cell title. The
      // expectation is its own series, so it carries its own observation date (10-13 here) rather than
      // borrowing the row's day — the row is 10-09.
      expect(host.querySelector('[data-asset-daily-detail="us10y"]')?.textContent).toBe('期限利差 +44bp · 通胀预期 2.33%（截至 2026-10-13）')
      expect(daily?.getAttribute('title')).toContain('期限利差 +44bp')
      expect(daily?.getAttribute('data-caveat')).toBe('official-daily-close')
      // Two legs on one day is not a mixed-observation-date row.
      expect(daily?.getAttribute('data-mixed-observation-dates')).toBeNull()
      // The signed change reuses the table's own direction mechanism rather than inventing a colour.
      expect(daily?.getAttribute('data-direction')).toBe('1')
      // The real rate has no 2Y leg, so its detail names only the inflation expectation.
      expect(host.querySelector('[data-asset-daily-detail="realRate"]')?.textContent).toBe('通胀预期 2.33%（截至 2026-10-13）')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('withholds the term spread when its two legs describe different trading days, and says why', async () => {
    // 2026-10-15, the live case: the 10-year and the real yield were 10-13, the 2-year had not caught
    // up, and the breakeven was already 10-14. A difference between two days describes no day, so the
    // cell states neither the number nor a caveat-free row — the analysis side refuses the same
    // arithmetic (`macroRatesFactProjection.ts`).
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    const readings = [
      { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.21, previous: 5.24, period: '2026-10-13' },
      { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.88, previous: 2.91, period: '2026-10-13' },
      { seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, previous: 4.79, period: '2026-10-09' },
      { seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.35, period: '2026-10-14' }
    ]
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, rates: ratesView({ readings }) as never, text })))
      const daily = host.querySelector<HTMLTableCellElement>('[data-asset-daily="us10y"]')!
      // The level and its own day-over-day change are unaffected: a withheld extra costs the extra.
      expect(host.querySelector('[data-asset-price="us10y"]')?.textContent).toBe('5.21%')
      expect(daily.textContent).toContain('日频 −3bp（截至 2026-10-13）')
      expect(host.querySelector('[data-asset-daily-detail="us10y"]')?.textContent).toBe('通胀预期 2.35%（截至 2026-10-14）')
      expect(daily.textContent).not.toContain(text.termSpread)
      // The caveat id comes from its owner, and its sentence is one hover away.
      expect(daily.getAttribute('data-mixed-observation-dates')).toBe('macro-rates-mixed-observation-dates')
      expect(daily.getAttribute('title')).toContain(text.dailyMixedDates)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('renders the daily change in the reader language rather than a hard-coded one', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, rates: ratesView() as never, text })))
      expect(host.querySelector('[data-asset-daily="us10y"]')?.textContent).toContain('Daily +2bp (as of 2026-10-09)')
      expect(host.querySelector('[data-asset-daily-detail="us10y"]')?.textContent).toBe('Term spread +44bp · Inflation expectation 2.33% (as of 2026-10-13)')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('shows a dash, never a fabricated number, when the prior trading day is unknown', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    const view = ratesView({ readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, period: '2026-10-09' }] })
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, rates: view as never, text })))
      const daily = host.querySelector('[data-asset-daily="us10y"]')!
      expect(daily.textContent).toBe('日频 —（截至 2026-10-09）')
      // The only digits on the cell are the observation date: no bp figure was invented for a change
      // this snapshot cannot compute, and no detail line sneaks one in either.
      expect(daily.textContent).not.toContain('bp')
      expect(daily.querySelector('small')).toBeNull()
      expect(host.querySelector('[data-asset-price="us10y"]')?.textContent).toBe('5.24%')
      // The other rate row has no reading at all, so it stays unconnected and figureless.
      expect(host.querySelector('[data-status-row="realRate"][data-connected="false"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it.each([
    ['no daily rates snapshot at all', undefined],
    ['an unavailable rates snapshot', { state: 'unavailable' }],
    ['an empty rates snapshot', { state: 'empty', asOf: '2026-10-14T12:00:00.000Z', readings: [], caveats: ['official-daily-close'] }]
  ])('keeps both rate rows unconnected and free of any figure with %s', async (_name, rates) => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, ...(rates === undefined ? {} : { rates: rates as never }), text })))
      for (const id of ['us10y', 'realRate']) {
        const row = host.querySelector(`[data-status-row="${id}"][data-connected="false"]`)!
        expect(row.querySelectorAll('[data-asset-price], [data-asset-return], [data-asset-daily]')).toHaveLength(0)
        expect(row.querySelector('.mi-cross-asset__not-connected')?.textContent).toContain(text.notConnected)
      }
      expect(host.textContent).not.toContain('5.24')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('promotes a rate row only for the series the daily snapshot actually carries', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    // A snapshot holding only the 2Y cannot fill either row: a rate row never borrows another series.
    const view = ratesView({ readings: [{ seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, period: '2026-10-09' }] })
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel,
        { client: client as never, rates: view as never, text })))
      for (const id of ['us10y', 'realRate']) {
        expect(host.querySelector(`[data-status-row="${id}"][data-connected="false"]`)).not.toBeNull()
        expect(host.querySelector(`[data-asset-price="${id}"]`)).toBeNull()
      }
      expect(host.textContent).not.toContain('4.80')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('owns three responsive layouts and visible tooltip bounds without changing dashboard overflow', () => {
    const css = readFileSync('products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css', 'utf8')
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container mi-cross-asset (min-width: 1200px)')
    // The status block carries six columns, so the wide/medium left tracks were widened from
    // 330px/270px; the chart keeps the middle track in both layouts.
    expect(css).toContain('--mi-cross-asset-quote-wide: 380px')
    expect(css).toContain('--mi-cross-asset-quote-medium: 320px')
    expect(css).toContain('minmax(0, var(--mi-cross-asset-quote-wide)) minmax(0, 1fr)')
    expect(css).toContain('@container mi-cross-asset (min-width: 800px)')
    expect(css).toContain('var(--mi-cross-asset-quote-medium) minmax(0, 1fr)')
    // 跨市场观察 is temporarily unrendered, so its track token and rules are gone with it.
    expect(css).not.toContain('--mi-cross-asset-observations-width')
    expect(css).not.toMatch(/\.mi-cross-asset__observations\s*\{/)
    expect(css).toContain('max-width: calc(100% - var(--mi-cross-asset-tooltip-inset) - var(--mi-cross-asset-tooltip-inset))')
    expect(css).not.toContain('overflow: hidden')
    // 五条线的颜色归调色板（`--mi-dashboard-chart-*`，`cryptoDashboard.css` 是唯一 owner），面板只命名；
    // 两两分得清那条规则由 `crossAssetChartPalette.test.ts` 按数值断言。
    expect(css).toContain('--mi-cross-asset-btc: var(--mi-dashboard-chart-btc)')
    expect(css).toContain('--mi-cross-asset-gold: var(--mi-dashboard-chart-gold)')
    // The return chart is sized to sit level with the status column, and the plot and empty state
    // must keep consuming the token.
    expect(css).toContain('--mi-cross-asset-chart-height: 100px')
    expect(css).toContain('--mi-cross-asset-chart-height-wide: 116px')
    // The plot's height is the grid row's, not a constant: the status table beside it sets how tall the
    // row is, and the chart has to end on the same line. The tokens are floors under the frame, so a
    // future edit that puts a fixed height back on the plot fails here rather than in a screenshot.
    expect(css).toContain('min-height: var(--mi-cross-asset-chart-height)')
    expect(css).toContain('min-height: var(--mi-cross-asset-chart-height-wide)')
    expect(css).toContain('[data-cross-asset-region="chart"] { display: flex; flex-direction: column; height: 100%')
    expect(css).not.toMatch(/\.mi-cross-asset__plot \{[^}]*height: var\(/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).toContain('--mi-cross-asset-text: var(--text)')
    expect(css).toContain('--mi-cross-asset-surface: var(--surface)')
    expect(css).not.toContain('border-top-style: dashed')
    expect(css).not.toContain('border-top-style: dotted')
    expect(css).toContain('minmax(0, var(--mi-cross-asset-quote-wide))')
    expect(css).toContain('box-sizing: border-box')
    // The daily rate cell reuses the table's type scale and muted token; it may only allow its context
    // line to break, not bring a look of its own.
    expect(css).toMatch(/\.mi-cross-asset__status-table td\.mi-cross-asset__daily \{\s*white-space: normal;\s*\}/)
    expect(css).toMatch(/\.mi-cross-asset__daily small \{[^}]*color: var\(--muted\)[^}]*font-size: 9px/)
  })

  it('withholds the reading lines without deleting the copy they are written from', async () => {
    // The reader asked for the rule explanation to be a later piece of work. Withheld, not removed:
    // both lines are still in both locales, so bringing the block back is not a rewrite — and it has
    // to come back **outside** the conclusion block, which is what lets a reader tell the product
    // explaining the figure from the model judging it. (The block never had a rule of its own in the
    // panel's CSS; it is styled by the panel's own paragraph rhythm, which stays put.)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: vi.fn() }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      expect(host.querySelector('[data-cross-asset-region="reading"]')).toBeNull()
      // 只断言"没有那个 data 属性"是不够的（评审 be5e5e55 的 ⑧：不带属性地把它加回来就能绕过）。
      // 读法那两行的文案不含占位符，所以直接断言"它的句子不在渲染结果里"。
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const withheld = productText[locale].pages.intelligence.portal.dashboard.crossAsset
        expect(host.textContent, locale).not.toContain(withheld.readingEvent)
      }
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const copy = productText[locale].pages.intelligence.portal.dashboard.crossAsset
        expect(copy.readingMarket.length).toBeGreaterThan(0)
        expect(copy.readingEvent.length).toBeGreaterThan(0)
      }
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('prints the reading the snapshot carries, and nothing when an older main process sends none', async () => {
    // The field is optional on the wire by design: a main process from before design 142 must still render
    // the panel — without the footnote — rather than failing the whole block closed.
    const now = Date.parse('2026-09-14T12:00:00.000Z')
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const base = createCrossAssetSnapshotQuery({ now: () => now, store: { revision: 0, queryAt: () => [] },
      live: () => ({ state: 'limited', quotes: { index: { state: 'stale', price: '712.30', tradedAtMs: now, receivedAtMs: now }, btc: { state: 'missing' }, eth: { state: 'missing' } } }) }).query({ range: '24h' })
    const withReading = { ...base, reading: {
      state: 'judged', window: '24h', scenario: 'risk-off',
      legs: [{ leg: 'dxy', direction: 'up', returnPercent: 0.42 }, { leg: 'gold', direction: 'up', returnPercent: 0.86 },
        { leg: 'index', direction: 'down', returnPercent: -1.12 }, { leg: 'btc', direction: 'down', returnPercent: -1.84 }],
      refuted: [{ scenario: 'discount-rate', leg: 'gold' }],
      correlation: { state: 'available', value: 0.68, sampleCount: 288, expectedCount: 288, window: '24h', interval: '5m' },
      relativeReturns: { btcMinusIndex: -0.72, ethMinusBtc: -0.47 }, notices: ['index-proxy']
    } } as never
    // 旧主进程的形状是"**没有**这个键"，而不是"键存在但为 undefined"：后者会被线协议直接拒收
    // （评审 2f774501 的探针），拿它当"兼容用例"等于在测一个永远不会从 wire 上来的形状。
    expect(parseCrossAssetSnapshot({ ...base, reading: undefined })).toBeUndefined()
    // `base` 本身带着一条 refusal 判读（服务侧每次 current 查询都会给），所以"旧主进程没有这个键"必须
    // 真的把键去掉——此前用 `base` 当反例，等于在测一个仍然有判读的快照。
    const { reading: omitted, ...withoutReading } = base as Record<string, unknown>
    void omitted
    for (const [snapshotValue, expected] of [[parseCrossAssetSnapshot(withReading)!, true], [parseCrossAssetSnapshot(withoutReading)!, false]] as const) {
      expect(snapshotValue, 'wire').toBeDefined()
      const host = document.createElement('div'); document.body.append(host)
      const root = createRoot(host)
      const client = { acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }),
        query: async () => snapshotValue, release: vi.fn(async () => ({ state: 'released' })) }
      try {
        await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
        const line = host.querySelector('[data-cross-asset-region="reading"]')
        expect(line === null, String(expected)).toBe(!expected)
        if (expected) {
          expect(line?.textContent).toContain(text.reading.scenarios['risk-off'])
          expect(host.querySelector('[data-reading-correlation]')?.textContent).toContain('24h·5m')
        }
      } finally { await act(async () => root.unmount()); host.remove() }
    }
  })

  it('offers every window the contract declares', async () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z')
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const asked: string[] = []
    const snapshot = createCrossAssetSnapshotQuery({ now: () => now, store: { revision: 0, queryAt: () => [] },
      live: () => ({ state: 'limited', quotes: { index: { state: 'missing' }, btc: { state: 'missing' }, eth: { state: 'missing' } } }) }).query({ range: '24h' })
    const client = { acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }),
      query: async (input: { range: string }) => { asked.push(input.range); return snapshot },
      release: vi.fn(async () => ({ state: 'released' })) }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetObservationPanel, { client: client as never, text })))
      // 选项直接来自契约：30d 是后来加上去的窗口，手抄一份清单就会漏掉它。
      expect([...host.querySelectorAll('.ant-segmented-item-label')].map(node => node.textContent)).toEqual(['1H', '24H', '7D'])
      expect(asked).toEqual(['24h'])
    } finally { await act(async () => root.unmount()); host.remove() }
  })

})
