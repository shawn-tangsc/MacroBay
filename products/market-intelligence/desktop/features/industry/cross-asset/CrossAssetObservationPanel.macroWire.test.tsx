// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { parseMacroMarketSnapshot } from '../../../../contracts/macro/macroMarketSnapshotContracts'

/**
 * The two macro rows against the payload the running main process really sends.
 *
 * The window vocabulary on the wire is the *producer's* ladder — 15m/1h/4h/24h, plus 7d once the
 * store reaches back a week — while the table prints four of those columns. `4h` is genuinely
 * answerable by the macro series (one stored point per fifteen minutes) and the analysis reads it as
 * its own horizon, so it belongs to the wire even though it is not one of this table's columns. The
 * cross-asset ladder has always worked this way: `5m` and `4h` cross it and are never rendered.
 *
 * Getting that wrong is expensive, not cosmetic. The macro snapshot contract fails closed on a whole
 * snapshot, so one window the contract does not recognise inside one reading voids *every* reading:
 * the renderer then prints 未接入 for the dollar and gold rows even though their data is stored and
 * fresh. That is the regression these fixtures pin — the payload below is the real one, verbatim from
 * `macro-market.sqlite` on 2026-10-14T15:24Z, including the `4h` key the running main process emits.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset

const asOf = '2026-10-14T15:24:10.637Z'
const atMs = (iso: string): number => Date.parse(iso)

/** The real store's own figures, key inclusive: 15m/1h/4h/24h and no 7d (hours, not a week, of data). */
const realDollar = {
  seriesId: 'dxy-real', level: 102.901, atMs: atMs('2026-10-14T15:20:00.000Z'),
  returns: { '15m': -0.019432380175099517, '1h': 0.06612663250122885, '4h': 0.31, '24h': 0.6475024207983182 }
}
const realGold = {
  seriesId: 'xau-usd', level: 4088.5754, atMs: atMs('2026-10-14T15:00:00.000Z'),
  returns: { '15m': -0.08589668561008734, '1h': -0.09915962084502405, '4h': -0.42, '24h': -1.8717475560323549 },
  live: { state: 'live' as const, price: '4088.5754', atMs: atMs('2026-10-14T15:24:07.000Z') }
}
const realYuan = { seriesId: 'usd-cnh', level: 6.7002, atMs: atMs('2026-10-14T15:00:00.000Z'), returns: { '15m': 0.0147, '1h': 0.0077, '4h': 0.03, '24h': 0.1098 } }
const realPeg = { seriesId: 'usdt-usd', level: 0.99893, atMs: atMs('2026-10-14T15:00:00.000Z'), returns: { '15m': -0.004, '1h': -0.004, '4h': -0.01, '24h': 0.021 } }
const wirePayload = {
  state: 'available', asOf, source: { enabled: true, hasCredential: true },
  readings: [realDollar, realGold, realYuan, realPeg],
  lastRunAtMs: atMs('2026-10-14T15:22:52.504Z'), lastPlan: 'dollar-basket', caveats: ['provider-time-series']
}

const hosts: HTMLElement[] = []
afterEach(() => { for (const host of hosts.splice(0)) host.remove() })

async function renderPayload(payload: unknown): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: async () => ({ state: 'released' }) }
  // The whole point: the panel is fed what the *renderer's* client would hand it, which is the
  // snapshot after the wire contract has had its say — not a literal the test wrote itself.
  const macroSnapshot = parseMacroMarketSnapshot(payload)
  await act(async () => createRoot(host).render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' },
    createElement(CrossAssetObservationPanel, { client: client as never, macroSnapshot: macroSnapshot as never, text }))))
  return host
}

const row = (host: HTMLElement, id: string): HTMLTableRowElement | null => host.querySelector(`[data-status-row="${id}"]`)
const cell = (host: HTMLElement, id: string, window: string): string | undefined =>
  host.querySelector(`[data-asset-return="${id}:${window}"]`)?.textContent ?? undefined

describe('the macro rows against the real wire payload', () => {
  it('admits the producer ladder, so the two rows answer with their real figures', async () => {
    expect(parseMacroMarketSnapshot(wirePayload)).toBeDefined()
    const host = await renderPayload(wirePayload)

    // 数据存在且新鲜 → 两行都是真实值，一行「未接入」都没有。
    expect(row(host, 'dxy')?.dataset.connected).toBe('true')
    expect(row(host, 'gold')?.dataset.connected).toBe('true')
    // Scoped to the two macro rows: the cross-asset client is stubbed out here, so the index row's
    // own 未接入 is this fixture's doing and not the regression under test.
    for (const id of ['dxy', 'gold']) {
      expect(row(host, id)?.querySelector('.mi-cross-asset__not-connected')).toBeNull()
      expect(row(host, id)?.textContent).not.toContain(text.notConnected)
    }

    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('102.90')
    expect(cell(host, 'dxy', '15m')).toBe('−0.02%')
    expect(cell(host, 'dxy', '1h')).toBe('+0.07%')
    expect(cell(host, 'dxy', '24h')).toBe('+0.65%')
    // The dollar wears no 合成 tag: the licensed index is the one answering.
    expect(host.querySelector('[data-synthetic="dxy"]')).toBeNull()

    // Gold's 最新 cell is the live tick, not the stored bar, and no window is computed from it.
    expect(host.querySelector('[data-asset-price="gold"]')?.textContent).toBe('4088.58')
    expect(host.querySelector('[data-status-row="gold"] [data-live-state]')).not.toBeNull()
    expect(cell(host, 'gold', '15m')).toBe('−0.09%')
    expect(cell(host, 'gold', '24h')).toBe('−1.87%')
  })

  it('carries 4h on the wire without printing it: the table has four columns, not five', async () => {
    const headers = [...(await renderPayload(wirePayload)).querySelectorAll('.mi-cross-asset__status-table thead th')].map(th => th.textContent)
    expect(headers).toEqual([text.statusColumns.asset, text.statusColumns.latest, '15m', '1h', '24h', '7d'])
    const host = await renderPayload(wirePayload)
    expect(host.querySelector('[data-asset-return="dxy:4h"]')).toBeNull()
    // 7d is a real absence: hours of stored data cannot answer a week, so the cell stays a dash.
    expect(cell(host, 'dxy', '7d')).toBe(text.windowNoData)
    expect(cell(host, 'gold', '7d')).toBe(text.windowNoData)
  })

  it('keeps 未接入 for rows with no reading, and never fills the gap with a figure', async () => {
    const empty = { ...wirePayload, state: 'empty', readings: [], caveats: [] }
    const host = await renderPayload(empty)
    for (const id of ['dxy', 'gold']) {
      expect(row(host, id)?.dataset.connected).toBe('false')
      expect(row(host, id)?.textContent).toContain(text.notConnected)
      expect(row(host, id)?.querySelectorAll('[data-asset-price], [data-asset-return]')).toHaveLength(0)
    }
  })

  it('falls back to the labelled synthesis once the licensed dollar stops arriving', async () => {
    const stale = { ...realDollar, atMs: atMs(asOf) - 15 * 60_000 - 1 }
    const synthetic = {
      seriesId: 'dxy-synthetic', level: 102.8762, atMs: atMs(asOf) - 6 * 60_000,
      returns: { '15m': 0.01, '1h': 0.02, '4h': 0.03, '24h': 0.04 }, synthetic: true as const
    }
    const host = await renderPayload({ ...wirePayload, readings: [stale, synthetic, realGold], caveats: ['synthetic-dollar-index', 'provider-time-series'] })
    expect(row(host, 'dxy')?.dataset.connected).toBe('true')
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('102.88')
    expect(host.querySelector('[data-synthetic="dxy"]')?.textContent).toBe(text.syntheticTag)
  })
})
