// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { createCrossAssetSnapshotQuery } from '../../../../service/intelligence/cross-asset/crossAssetSnapshotQuery'
import type { CrossAssetIndexFeedState, CrossAssetLiveState } from '../../../../service/intelligence/cross-asset/crossAssetIndexSource'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/**
 * What the Nasdaq 100 row shows in each of its four states, read from the rendered table.
 *
 * These are the reader-facing half of the honesty rule. The row's default is Binance's tokenised
 * perpetual, so it trades at any hour — and because it is a synthetic, the 代理 label rides with it
 * every time it answers. The licensed cash index answers only when that leg cannot, prints its last
 * closed bar, and says 休市 while its own market is shut. A row with no reading says 未接入, with no
 * figure and no window at all.
 */
const STEP = 300_000
const at = (iso: string) => Date.parse(iso)
const sessionOpenMs = at('2026-07-15T13:30:00.000Z')
const sessionCloseMs = at('2026-07-15T20:00:00.000Z')
/** 22:00 New York: the cash market is shut while the perpetual keeps printing. */
const overnightMs = at('2026-07-16T02:00:00.000Z')
const bar = (symbol: string, barOpenMs: number, close: number) => ({
  symbol, barOpenMs, barEndMs: barOpenMs + STEP, open: String(close), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1'
})
const grid = (fromMs: number, toMsExclusive: number) => {
  const instants: number[] = []
  for (let atMs = fromMs; atMs < toMsExclusive; atMs += STEP) instants.push(atMs)
  return instants
}
const sessionBars = grid(sessionOpenMs, sessionCloseMs).map((atMs, index) => bar('USTEC', atMs, 25_000 + index))
const cryptoBars = (symbol: string, endMs: number) =>
  grid(endMs - 289 * STEP, endMs).map((atMs, index) => bar(symbol, atMs, 100 + index / 100))
/** Both legs stored: the default must pick the perpetual even though the licensed session exists. */
const bothLegs = (nowMs: number) => ({
  USTEC: sessionBars, QQQUSDT: cryptoBars('QQQUSDT', nowMs),
  BTCUSDT: cryptoBars('BTCUSDT', nowMs), ETHUSDT: cryptoBars('ETHUSDT', nowMs)
})

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
const ScopedPanel = (props: Parameters<typeof CrossAssetObservationPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CrossAssetObservationPanel, props))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function render(input: Readonly<{
  nowMs: number; bySymbol: Record<string, readonly unknown[]>; feed: CrossAssetIndexFeedState
  liveState?: CrossAssetLiveState; range?: '1h' | '24h'
}>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const live = { state: input.liveState ?? 'live' as CrossAssetLiveState, quotes: {
    index: { state: 'live' as const, price: '710.55', tradedAtMs: input.nowMs, receivedAtMs: input.nowMs },
    btc: { state: 'missing' as const }, eth: { state: 'missing' as const }
  } }
  const snapshot = createCrossAssetSnapshotQuery({
    now: () => input.nowMs,
    store: {
      revision: 1,
      queryAt: (request: { symbol: string; fromMs: number; toMs: number; asOfMs: number }) =>
        ((input.bySymbol[request.symbol] ?? []) as ReturnType<typeof bar>[])
          .filter(entry => entry.barOpenMs >= request.fromMs && entry.barOpenMs <= request.toMs && entry.barEndMs <= request.asOfMs)
    } as never,
    live: () => live,
    indexFeed: () => ({ state: input.feed })
    // The hook opens on the 24h range, and it hides a snapshot whose range is not the one it asked for.
  }).query({ range: input.range ?? '24h' })
  const client = {
    acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }),
    query: async () => snapshot, release: vi.fn(async () => ({ state: 'released' }))
  }
  await act(async () => root.render(createElement(ScopedPanel, { client: client as never, text })))
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

const row = (host: HTMLElement) => host.querySelector<HTMLTableRowElement>('[data-status-row="index"]')!
const cell = (host: HTMLElement, window: string) => host.querySelector(`[data-asset-return="index:${window}"]`)!

describe('cross-asset Nasdaq 100 row, as rendered', () => {
  it('shows the tokenised perpetual by default, labelled as a proxy, at an hour the cash market is shut', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs) })
    try {
      const indexRow = row(page.host)
      expect(indexRow.dataset.indexSource).toBe('proxy')
      expect(indexRow.dataset.connected).toBe('true')
      // The name follows the instrument that answers: this row prints QQQUSDT's price, so it is called
      // QQQ. Naming it 纳斯达克 100 here was the mismatch the reader caught immediately.
      expect(indexRow.dataset.indexName).toBe('QQQ')
      expect(indexRow.querySelector('th')?.textContent).toContain('QQQ')
      expect(indexRow.querySelector('th')?.textContent).not.toContain(text.indexNames.real)
      // The chart legend carries the same name as the row, above the same curve.
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend button')].map(button => button.textContent))
        .toEqual(['QQQ', 'BTC', 'ETH'])
      // The default is a synthetic, so the label is what stops it being read as the standard index.
      const label = page.host.querySelector('[data-index-proxy="true"]')
      expect(label?.textContent).toBe(text.proxyTag)
      expect(label?.getAttribute('data-caveat')).toBe('tokenized-index-proxy')
      expect(label?.getAttribute('title')).toBe(text.proxyCaveat)
      // A 24/7 contract has no session to report, so no closure tag rides beside the live price.
      expect(indexRow.dataset.marketState).toBe('open')
      expect(page.host.querySelector('[data-market-state-tag="closed"]')).toBeNull()
      expect(page.host.querySelector('[data-asset-price="index"]')?.textContent).toBe('710.55')
      // A contract that prints all day can answer the intraday windows at any hour…
      for (const window of ['15m', '1h', '24h']) {
        expect(cell(page.host, window).textContent, window).toMatch(/[0-9]/)
        expect(cell(page.host, window).textContent, window).not.toBe(text.windowNoData)
      }
      // …but 7d is not an hour-of-day question. This snapshot was taken on the 24h range, whose curve
      // covers twenty-four hours, so no curve reaches back seven days and the column stays 无数据.
      expect(cell(page.host, '7d').textContent).toBe(text.windowNoData)
    } finally { await page.unmount() }
  })

  it('falls back to the real index with no proxy label when the Binance source is switched off', async () => {
    const nowMs = at('2026-07-15T15:00:00.000Z') // 11:00 New York, cash session open
    const page = await render({ nowMs, feed: 'ready', liveState: 'disabled', bySymbol: bothLegs(nowMs) })
    try {
      const indexRow = row(page.host)
      expect(indexRow.dataset.indexSource).toBe('real')
      expect(indexRow.dataset.marketState).toBe('open')
      // The licensed index answers, so the row takes the index's name.
      expect(indexRow.dataset.indexName).toBe(text.indexNames.real)
      expect(indexRow.querySelector('th')?.textContent).toContain(text.indexNames.real)
      // The licensed index is the standard instrument: no proxy label, because it is not a proxy.
      expect(page.host.querySelector('[data-index-proxy="true"]')).toBeNull()
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend button')].map(button => button.textContent))
        .toEqual([text.indexNames.real, 'BTC', 'ETH'])
      expect(page.host.querySelector('[data-market-state-tag="closed"]')).toBeNull()
      expect(page.host.querySelector('[data-asset-price="index"]')?.textContent).toBe('25017.00')
      expect(cell(page.host, '15m').textContent).toMatch(/[0-9]/)
      expect(cell(page.host, '1h').textContent).toMatch(/[0-9]/)
      // 7d reaches back past anything the cash index printed in this fixture, so it stays unanswered.
      expect(cell(page.host, '24h').textContent).toBe(text.windowNoData)
    } finally { await page.unmount() }
  })

  it('keeps the real value and tags 休市 outside the session, without going back to the proxy', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', liveState: 'disabled', bySymbol: bothLegs(overnightMs) })
    try {
      const indexRow = row(page.host)
      expect(indexRow.dataset.indexSource).toBe('real')
      expect(indexRow.dataset.marketState).toBe('closed')
      // A closed session keeps both the real value and the real name.
      expect(indexRow.dataset.indexName).toBe(text.indexNames.real)
      expect(page.host.querySelector('[data-market-state-tag="closed"]')?.textContent).toBe(text.marketClosed)
      expect(page.host.querySelector('[data-index-proxy="true"]')).toBeNull()
      // The last closed bar is still the row's value, and no window pretends to have a new one.
      expect(page.host.querySelector('[data-asset-price="index"]')?.textContent).toBe('25077.00')
      for (const window of ['15m', '1h', '24h', '7d']) {
        expect(cell(page.host, window).textContent, window).toBe(text.windowNoData)
        expect(cell(page.host, window).textContent, window).not.toMatch(/[0-9]/)
      }
    } finally { await page.unmount() }
  })

  it('says 未接入 with no figure and no window when neither leg can answer', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'unavailable', liveState: 'disabled', bySymbol: {} })
    try {
      const indexRow = row(page.host)
      expect(indexRow.dataset.indexSource).toBe('unavailable')
      expect(indexRow.dataset.connected).toBe('false')
      // An unanswered row is named after its default instrument — what it would display — so the name
      // never promises an instrument that is not on screen.
      expect(indexRow.dataset.indexName).toBe(text.indexNames.proxy)
      // No price cell, no window cell, and no number anywhere in the value cell.
      expect(indexRow.querySelectorAll('[data-asset-price], [data-asset-return]')).toHaveLength(0)
      // The label legitimately contains a digit ("纳斯达克 100"); the value cell must not.
      expect(indexRow.querySelector('.mi-cross-asset__not-connected')?.textContent).toContain(text.notConnected)
      expect(indexRow.querySelector('.mi-cross-asset__not-connected')?.textContent).not.toMatch(/[0-9]/)
      expect(indexRow.textContent).not.toMatch(/\d+\.\d+/)
      expect(page.host.querySelector('[data-index-proxy="true"]')).toBeNull()
    } finally { await page.unmount() }
  })
})
