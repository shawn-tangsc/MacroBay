// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { createCrossAssetSnapshotQuery } from '../../../../service/intelligence/cross-asset/crossAssetSnapshotQuery'
import type { CrossAssetIndexFeedState, CrossAssetLiveState } from '../../../../service/intelligence/cross-asset/crossAssetIndexSource'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

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
  createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(CrossAssetObservationPanel, props) }) })

async function render(input: Readonly<{
  nowMs: number; bySymbol: Record<string, readonly unknown[]>; feed: CrossAssetIndexFeedState
  liveState?: CrossAssetLiveState; range?: '1h' | '24h'
  /** 读者在设置里关掉的格（行 id）；不给就是全都没关。 */
  hideStatusRows?: readonly ('index' | 'btc' | 'eth' | 'dxy' | 'gold' | 'us10y' | 'realRate')[]
  /** 每行的三态；配合 `cellStateLabels` 才生效。 */
  rowStates?: Partial<Record<'index' | 'btc' | 'eth' | 'dxy' | 'gold' | 'us10y' | 'realRate', 'disabled' | 'unreadable'>>
  /** 源状态表沿用了上一次成功的读数时的短标注。 */
  sourceStatusStale?: string
  /** 「启用数据」的去处（宿主给）。 */
  onEnableData?: () => void
  /** 这条通道自己读不到：`query` = 查询失败，`contract` = 版本不一致。 */
  queryFailure?: 'query' | 'contract'
  /** BTC/ETH 实时报价那条腿的状态（默认两者都是 `missing`）。 */
  quotes?: Partial<Record<'btc' | 'eth', 'live' | 'stale' | 'missing'>>
  /** 美元/黄金两条线读的宏观序列；不给＝这一版没有宏观库，图上没有这两条线。 */
  macroSeries?: (seriesId: string, fromMs: number, toMs: number) => readonly { atMs: number; value: number }[]
  /** 美元那条宏观读数（含服务侧挂的永久拒绝）；不给＝这一格没有宏观读数。 */
  macroReading?: Readonly<{ atMs: number; sourceFailure?: 'symbol-not-supported' }>
}>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const quoteOf = (asset: 'btc' | 'eth') => {
    const state = input.quotes?.[asset] ?? 'missing'
    return state === 'live' || state === 'stale'
      ? { state, price: '118.25', tradedAtMs: input.nowMs, receivedAtMs: input.nowMs }
      : { state: 'missing' as const }
  }
  const live = { state: input.liveState ?? 'live' as CrossAssetLiveState, quotes: {
    index: { state: 'live' as const, price: '710.55', tradedAtMs: input.nowMs, receivedAtMs: input.nowMs },
    btc: quoteOf('btc'), eth: quoteOf('eth')
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
    indexFeed: () => ({ state: input.feed }),
    ...(input.macroSeries === undefined ? {} : { macroSeries: input.macroSeries })
    // The hook opens on the 24h range, and it hides a snapshot whose range is not the one it asked for.
  }).query({ range: input.range ?? '24h' })
  const client = {
    acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }),
    query: async () => input.queryFailure === undefined
      ? snapshot
      : ({ state: 'unavailable' as const, cause: input.queryFailure }),
    release: vi.fn(async () => ({ state: 'released' })),
    // 「再试一次」走的就是 `view.refresh()` → 这里这一条 client 调用（不是第二套实现）。
    refresh: vi.fn(async () => ({ state: 'accepted' })),
    renew: vi.fn(async () => ({ state: 'active' }))
  }
  await act(async () => root.render(createElement(ScopedPanel, {
    client: client as never, text,
    ...(input.hideStatusRows === undefined ? {} : { hideStatusRows: input.hideStatusRows }),
    ...(input.rowStates === undefined ? {} : {
      rowStates: input.rowStates,
      cellStateLabels: { disabled: '数据未被启用', unreadable: '暂时读不到' }
    }),
    ...(input.sourceStatusStale === undefined ? {} : { sourceStatusStale: input.sourceStatusStale }),
    ...(input.macroReading === undefined ? {} : {
      // 美元那条读数：`sourceFailure` 由服务侧按采集器的品种级失败挂上来（这里只是夹具）。
      macroSnapshot: {
        state: 'available' as const, asOf: new Date(input.nowMs).toISOString(),
        source: { enabled: true, hasCredential: true },
        readings: [{
          seriesId: 'dxy-real', level: 103.407, atMs: input.macroReading.atMs, returns: {},
          ...(input.macroReading.sourceFailure === undefined ? {} : { sourceFailure: input.macroReading.sourceFailure })
        }],
        caveats: []
      }
    }),
    ...(input.onEnableData === undefined ? {} : { onEnableData: input.onEnableData })
  })))
  return { host, client, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

const row = (host: HTMLElement) => host.querySelector<HTMLTableRowElement>('[data-status-row="index"]')!
const cell = (host: HTMLElement, window: string) => host.querySelector(`[data-asset-return="index:${window}"]`)!

describe('cross-asset Nasdaq 100 row, as rendered', () => {
  it('drops the 纳指 curve and its legend entry with the cell that produced it', async () => {
    // 格关掉 = 这一格的数据不再交给卡片：表里那行、图上那条线、图例里那个名字一起消失。
    // 同源的 BTC / ETH 两格还开着，所以这两条线照旧。
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), hideStatusRows: ['index'] })
    try {
      expect(page.host.querySelector('[data-status-row="index"]')).toBeNull()
      expect(page.host.querySelector('[data-asset-line="index"]')).toBeNull()
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend button')].map(button => button.textContent))
        .toEqual(['BTC', 'ETH'])
      expect(page.host.querySelector('[data-asset-line="btc"]')).not.toBeNull()
    } finally {
      await page.unmount()
    }
  })

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
      expect(label?.getAttribute('title')).toBeNull()
      expect(label?.getAttribute('tabindex')).toBeNull()
      expect(label?.getAttribute('aria-label')).toBe(text.proxyCaveat)
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
      // 合法指数这一腿在这个夹具里没有任何可画的点（289 个点全是空），所以图例照样列出、
      // 名字后面说「本段无数据」——但它不是控件：点它没有任何可见结果（界面设计 2026-11-16）。
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend > *')].map(item => item.textContent))
        .toEqual([`${text.indexNames.real}${text.lineNoComparableData}`, 'BTC', 'ETH'])
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend button')].map(button => button.textContent))
        .toEqual(['BTC', 'ETH'])
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
      // The last closed bar is still the row's value.
      expect(page.host.querySelector('[data-asset-price="index"]')?.textContent).toBe('25077.00')
      // 收盘后分析瞬时那一桶没有收盘：窗口**回退到库里最近一根完整的桶**，短窗口照常有数；
      // 只有回看端真的没有收盘对的 24h/7d 仍是 `—`，并且那句说明与「本次还没落库」不同。
      for (const window of ['15m', '1h'] as const) {
        expect(cell(page.host, window).textContent, window).toMatch(/[0-9]/)
      }
      for (const window of ['24h', '7d'] as const) {
        expect(cell(page.host, window).textContent, window).toBe(text.windowNoData)
        expect(cell(page.host, window).getAttribute('data-window-reason'), window).toBe('missing')
        expect(cell(page.host, window).getAttribute('aria-label'), window).toBe(text.windowNoPair)
        expect(cell(page.host, window).getAttribute('aria-label'), window).not.toBe(text.noData)
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


describe('cross-asset chart with only some lines usable', () => {
  it('keeps the chart while at least one line is usable, and drops only the others', async () => {
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      rowStates: { index: 'disabled', eth: 'disabled' }
    })
    try {
      // 一条可用（BTC）→ 图在，坐标正常；不可用的线不画。
      expect(page.host.querySelector('[data-cross-asset-region="chart"]')).not.toBeNull()
      expect(page.host.querySelector('[data-asset-line="btc"]')).not.toBeNull()
      expect(page.host.querySelector('[data-asset-line="index"]')).toBeNull()
      expect(page.host.querySelector('[data-asset-line="eth"]')).toBeNull()
    } finally { await page.unmount() }
  })

  it('drops the whole chart and shows the state sentence only when no line is usable', async () => {
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      rowStates: { index: 'disabled', btc: 'disabled', eth: 'disabled' }
    })
    try {
      expect(page.host.querySelector('[data-cross-asset-region="chart"]')).toBeNull()
      expect(page.host.querySelector('[data-asset-line]')).toBeNull()
      expect(page.host.querySelector('[data-state="disabled"]')).not.toBeNull()
      expect(page.host.textContent).toContain('数据未被启用')
    } finally { await page.unmount() }
  })
})


describe('市场状态表的三态粒度（界面设计 2026-11-11）', () => {
  const allUnreadable = {
    index: 'unreadable' as const, btc: 'unreadable' as const, eth: 'unreadable' as const,
    dxy: 'unreadable' as const, gold: 'unreadable' as const, us10y: 'unreadable' as const, realRate: 'unreadable' as const
  }

  const ALL_ROWS = ['index', 'btc', 'eth', 'dxy', 'gold', 'us10y', 'realRate'] as const
  /** 标题右边那颗「补数据」按钮（同屏只许有一处）。 */
  const titleAction = (host: HTMLElement): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>('.mi-cross-asset__quote-heading button')]
      .find(button => ['启用数据', '再试一次', '去启用', '更新历史'].includes(button.textContent ?? ''))
  const allActions = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('button')]
      .map(button => button.textContent ?? '')
      .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))

  it('whole table unreadable: the table keeps its rows and headers, one retry in the title, no state block', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), rowStates: allUnreadable })
    try {
      // 不再是「一整块提示吃掉半张卡」：七行行位都在，每个行自己说自己的状态。
      expect(page.host.querySelectorAll('tr[data-status-row]')).toHaveLength(ALL_ROWS.length)
      for (const id of ALL_ROWS) {
        expect(page.host.querySelector(`tr[data-status-row="${id}"] .mi-source-state[data-state="unreadable"]`)).not.toBeNull()
      }
      // 列头也在。
      expect(page.host.querySelector('thead th')).not.toBeNull()
      // 整块状态面与表尾都没了。
      expect(page.host.querySelector('[data-status-section="unavailable"]')).toBeNull()
      expect(page.host.querySelector('tfoot')).toBeNull()
      // 表里不再出现整块状态面（图区那一处失败提示是另一件事，按区域限定）。
      expect(page.host.querySelector('[data-cross-asset-region="status"] .state-view')).toBeNull()
      // 动作只剩标题那一颗，而且它调的就是 `view.refresh()` 那条 client 调用。
      expect(allActions(page.host)).toEqual(['再试一次'])
      await act(async () => titleAction(page.host)!.click())
      expect(page.client.refresh).toHaveBeenCalledTimes(1)
      expect(page.client.refresh).toHaveBeenCalledWith('test-lease')
    } finally { await page.unmount() }
  })

  it('partial: only that row is a state row, no button inside it, the retry sits in the title', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), rowStates: { index: 'unreadable' } })
    try {
      const row = page.host.querySelector<HTMLTableRowElement>('tr[data-status-row="index"]')!
      expect(row.getAttribute('aria-disabled')).toBe('true')
      expect(row.querySelector('.mi-source-state[data-state="unreadable"]')).not.toBeNull()
      // 状态词横跨数据列（不占行名列），行内没有按钮。
      const stateCell = row.querySelector<HTMLTableCellElement>('td.mi-cross-asset__state-cell')!
      expect(Number(stateCell.getAttribute('colspan'))).toBeGreaterThan(1)
      expect(row.querySelectorAll('button')).toHaveLength(0)
      // 不许逐列铺「—」。
      expect(row.textContent).not.toContain('—')
      // 表尾那颗没了；动作只剩标题一颗。
      expect(page.host.querySelector('tfoot')).toBeNull()
      expect(allActions(page.host)).toEqual(['再试一次'])
      // 其它行照常是数据行（有窗口单元格）。
      expect(page.host.querySelectorAll('tr[data-status-row="btc"] [data-asset-return]').length).toBeGreaterThan(0)
    } finally { await page.unmount() }
  })
})

describe('标题右边那颗按钮：这一张卡唯一的「补数据」入口（用户 2026-11-11）', () => {
  const ALL_ROWS = ['index', 'btc', 'eth', 'dxy', 'gold', 'us10y', 'realRate'] as const
  const allActions = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('button')]
      .map(button => button.textContent ?? '')
      .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))

  it('shows nothing when every source behind the card is configured and reads', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs) })
    try {
      expect(allActions(page.host)).toHaveLength(0)
      // 表格照常是数据表。
      expect(page.host.querySelector('tr[data-status-row="index"] [data-asset-price]')).not.toBeNull()
    } finally { await page.unmount() }
  })

  it('offers 「启用数据」 when a source is not configured, and routes to the host’s entry', async () => {
    const onEnableData = vi.fn()
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      rowStates: { dxy: 'disabled' }, onEnableData
    })
    try {
      expect(allActions(page.host)).toEqual(['启用数据'])
      const button = [...page.host.querySelectorAll<HTMLButtonElement>('.mi-cross-asset__quote-heading button')]
        .find(candidate => candidate.textContent === '启用数据')!
      await act(async () => button.click())
      expect(onEnableData).toHaveBeenCalledTimes(1)
      // 没配好这一支不许同时给出「再试一次」：同屏只留一处入口。
      expect(page.host.querySelectorAll('tfoot')).toHaveLength(0)
    } finally { await page.unmount() }
  })

  it('offers 「再试一次」 when the sources are configured but a row could not be read', async () => {
    const onEnableData = vi.fn()
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      rowStates: { gold: 'unreadable' }, onEnableData
    })
    try {
      expect(allActions(page.host)).toEqual(['再试一次'])
      const button = [...page.host.querySelectorAll<HTMLButtonElement>('.mi-cross-asset__quote-heading button')]
        .find(candidate => candidate.textContent === '再试一次')!
      await act(async () => button.click())
      // 没配好的入口不被误触，走的是 `view.refresh()` 那条。
      expect(onEnableData).not.toHaveBeenCalled()
      expect(page.client.refresh).toHaveBeenCalledTimes(1)
    } finally { await page.unmount() }
  })

  it('keeps one action when both kinds are present, and 启用数据 wins', async () => {
    const onEnableData = vi.fn()
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      rowStates: { dxy: 'disabled', gold: 'unreadable' }, onEnableData
    })
    try {
      expect(allActions(page.host)).toEqual(['启用数据'])
    } finally { await page.unmount() }
  })
})





describe('「无数据」那句按腿说（用户 2026-11-11）', () => {
  const legOf = (host: HTMLElement, asset: 'btc' | 'eth'): string =>
    (host.querySelector(`[data-quote-asset="${asset}"]`)?.textContent ?? '').trim()

  it('says the live quote leg is not connected, not that the asset has no data', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), quotes: { btc: 'missing', eth: 'missing' } })
    try {
      expect(legOf(page.host, 'btc')).toBe(`${text.assets.btc} ${text.quoteLeg.missing}`)
      // 笼统的「无数据」不许出现在这一行：同一行 24h/7d 明明有数。
      expect(page.host.querySelector('[data-quote-asset="btc"]')?.textContent).not.toContain(text.states.missing)
      // 原因进 ⓘ（触发器的可访问名就是那句原因），正文不铺解释句。
      const trigger = page.host.querySelector(`[data-quote-asset="btc"] button[aria-label]`)
      expect(trigger?.getAttribute('aria-label')).toBe(text.quoteLegReasons.missing)
      expect(page.host.querySelector('[data-quote-asset="btc"]')?.textContent?.trim())
        .not.toContain(text.quoteLegReasons.missing)
    } finally { await page.unmount() }
  })

  it('says the live quote is out of date, with its own sentence and reason', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), quotes: { btc: 'stale', eth: 'live' } })
    try {
      expect(legOf(page.host, 'btc')).toBe(`${text.assets.btc} ${text.quoteLeg.stale}`)
      // 过期那一句不跟「未连接」混用。
      expect(legOf(page.host, 'btc')).not.toContain(text.quoteLeg.missing)
      expect(page.host.querySelector('[data-quote-asset="btc"] button[aria-label]')?.getAttribute('aria-label'))
        .toBe(text.quoteLegReasons.stale)
      // 另一条腿是 live：一个字都不说。
      expect(page.host.querySelector('[data-quote-asset="eth"]')).toBeNull()
    } finally { await page.unmount() }
  })
})

describe('图例要回答这一段的数据怎么了（用户 2026-11-16）', () => {
  it('says there is no data in this stretch instead of talking about the renderer, and keeps the reason in the title ⓘ', async () => {
    // 这个夹具里合法指数那一腿 289 个点全是空：没有可比数据，图例照样列出。
    const page = await render({ nowMs: at('2026-07-15T15:00:00.000Z'), feed: 'ready', liveState: 'disabled', bySymbol: bothLegs(at('2026-07-15T15:00:00.000Z')) })
    try {
      const noData = page.host.querySelector('[data-no-comparable-data="index"]')
      expect(noData).not.toBeNull()
      // 它是图例里的一行文字，不是控件：不是 button、不在 button 里、不能聚焦、没有颜色点。
      expect(noData?.closest('button')).toBeNull()
      expect(noData?.tagName).toBe('SPAN')
      expect(noData?.getAttribute('tabindex')).toBeNull()
      expect(noData?.getAttribute('role')).toBeNull()
      expect(noData?.querySelector('i')).toBeNull()
      expect(noData?.textContent).toBe(`${text.indexNames.real}${text.lineNoComparableData}`)
      expect(noData?.querySelector('small')?.textContent).toBe(text.lineNoComparableData)
      // 有数据的线照旧是切换按钮，也没有这个标记。
      expect(page.host.querySelector('[data-no-comparable-data="btc"]')).toBeNull()
      expect(page.host.querySelector('.mi-cross-asset__legend button[data-asset="btc"]')).not.toBeNull()
      // 说的是数据，不是渲染：这句里不许出现「画 / 绘制 / 渲染」。
      expect(text.lineNoComparableData).not.toMatch(/绘制|渲染|画/)
      // 原因句同样说数据、不说实现：不出现「线要求 / 5 分钟 K 线」这类实现细节。
      expect(text.lineNoComparableDataReason).not.toMatch(/K 线|要求|绘制|渲染|画/)
      // 原因在图标题那颗 ⓘ 的浮层里（点开才渲染），图例里不再铺解释。
      expect(noData?.textContent).not.toContain(text.lineNoComparableDataReason)
      const hint = page.host.querySelector<HTMLButtonElement>('.mi-cross-asset__chart-toolbar button[aria-label]')!
      await act(async () => hint.click())
      expect(document.body.textContent).toContain(text.lineNoComparableDataReason)
    } finally { await page.unmount() }
  })

  it('covers the dollar line too: a weekend leaves every point empty, and the reason is still reachable', async () => {
    // 用户 2026-11-16 截图：美元 DXY 后面跟着一句说渲染器的话。周末美元没有新收盘，整窗都是空点——
    // 这不是读失败，是这一段没有可比数据。宏观两条线也得有同一句，不能只有三条资产腿有。
    const nowMs = at('2026-07-19T12:00:00.000Z') // Sunday
    const page = await render({
      nowMs, feed: 'ready', bySymbol: bothLegs(nowMs),
      // 只有一次收盘，落在窗口开始前 30 小时：够锚定窗口（上限 72 小时），但整窗没有新收盘
      // （carry 上限 24 小时），所以每个点都是空的。
      macroSeries: seriesId => seriesId === 'xau-usd' ? [] : [{ atMs: nowMs - 54 * 3_600_000, value: 102 }]
    })
    try {
      const noData = page.host.querySelector('[data-no-comparable-data="dxy"]')
      expect(noData).not.toBeNull()
      // 这一条不是按钮：无数据的线点不出任何可见结果，留着就是假控件（界面设计 2026-11-16）。
      expect(page.host.querySelector('.mi-cross-asset__legend button[data-asset="dxy"]')).toBeNull()
      expect(noData?.closest('button')).toBeNull()
      expect(noData?.getAttribute('tabindex')).toBeNull()
      expect(noData?.querySelector('i')).toBeNull()
      expect(noData?.textContent).toBe(`${text.assetLabels.dxy}${text.lineNoComparableData}`)
      // 有数据的几条照旧是切换按钮，顺序不变。
      expect([...page.host.querySelectorAll('.mi-cross-asset__legend button')].map(button => button.textContent))
        .toEqual(['QQQ', 'BTC', 'ETH'])
      // 黄金这一腿没有曲线，图例里根本没有它，所以也不会被标成「本段无数据」。
      expect(page.host.querySelector('.mi-cross-asset__legend [data-asset="gold"]')).toBeNull()
      const hint = page.host.querySelector<HTMLButtonElement>('.mi-cross-asset__chart-toolbar button[aria-label]')!
      await act(async () => hint.click())
      expect(document.body.textContent).toContain(text.lineNoComparableDataReason)
    } finally { await page.unmount() }
  })

  it('covers the whole row and drops the line from the legend when the provider no longer carries the instrument', async () => {
    // 真机 2026-11-16 + 用户当日口径：源不能用就像关格一样**整行挡住**，图上**直接不出现**这条线；
    // 不要说明文字，原因只在图标题的 ⓘ 里（一行，合计仍 4 行）。
    const nowMs = at('2026-07-19T12:00:00.000Z')
    const refusedAt = at('2026-07-17T21:55:00.000Z')
    const page = await render({
      nowMs, feed: 'ready', bySymbol: bothLegs(nowMs),
      macroSeries: seriesId => seriesId === 'xau-usd' ? [] : [{ atMs: nowMs - 54 * 3_600_000, value: 102 }],
      macroReading: { atMs: refusedAt, sourceFailure: 'symbol-not-supported' }
    })
    try {
      // 默认开：这一行根本不出现（用户 2026-11-16 第二版口径）。
      expect(page.host.querySelector('[data-status-row="dxy"]')).toBeNull()
      // 图例里这条线也不出现。
      expect(page.host.querySelector('.mi-cross-asset__legend [data-asset="dxy"]')).toBeNull()
      expect(page.host.querySelector('[data-no-comparable-data="dxy"]')).toBeNull()
      // 关掉开关：整行遮住，只剩一句状态，没有数字、窗口、日期句。
      const toggle = page.host.querySelector<HTMLElement>('[role="switch"]')!
      await act(async () => toggle.click())
      const row = page.host.querySelector('[data-status-row="dxy"]')!
      expect(row.getAttribute('data-source-state')).toBe('unreadable')
      expect(row.textContent).toContain(text.sourceRefused)
      expect(row.querySelector('[data-asset-price]')).toBeNull()
      expect(row.querySelector('[data-asset-return]')).toBeNull()
      expect(row.querySelector('button[aria-label]')).toBeNull()
      // 原因只在 ⓘ 里说一次。
      const hint = page.host.querySelector<HTMLButtonElement>('.mi-cross-asset__chart-toolbar button[aria-label]')!
      await act(async () => hint.click())
      expect(document.body.textContent).toContain('供应商当前套餐不提供这个品种，最近一次收盘 2026-07-17 21:55:00 GMT')
      expect(document.body.textContent).not.toContain(text.lineNoComparableDataReason)
    } finally { await page.unmount() }
  })

  it('does not lend this sentence to a read failure: an unreadable row leaves the legend instead', async () => {
    // 「这一段没有可比数据」与「这次读不到」是两件事：读不到时这条线根本不进图例，状态由表里那一行说；
    // 不许把读失败画成数据缺口（用户红线：缺什么、读不到什么，分开说）。
    const nowMs = at('2026-07-19T12:00:00.000Z')
    const page = await render({
      nowMs, feed: 'ready', bySymbol: bothLegs(nowMs),
      macroSeries: seriesId => seriesId === 'xau-usd' ? [] : [{ atMs: nowMs - 54 * 3_600_000, value: 102 }],
      rowStates: { dxy: 'unreadable' }
    })
    try {
      expect(page.host.querySelector('.mi-cross-asset__legend [data-asset="dxy"]')).toBeNull()
      expect(page.host.querySelector('[data-no-comparable-data="dxy"]')).toBeNull()
      // 行自己的状态照旧在表里：读不到说的是读失败，不是「没有数据」。
      expect(page.host.querySelector('[data-status-row="dxy"]')?.textContent).toContain('暂时读不到')
    } finally { await page.unmount() }
  })
})

describe('通道不可用时结构要留（用户 2026-11-11）', () => {
  const columnNames = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('.mi-cross-asset__status-table thead th')].map(cell => (cell.textContent ?? '').trim())

  it('keeps the header and every column name, puts the sentence right under the header, and one action only', async () => {
    // 首读失败要等退避阶梯走完（1+2+4+8+16s）才落终态，这里用假时钟推完，不 sleep。
    vi.useFakeTimers()
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), queryFailure: 'query' })
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(32_000) })
      const table = page.host.querySelector('.mi-cross-asset__status-table')!
      // 表头与列名逐个在（资产 / 最新 / 15m / 1h / 24h / 7d）。
      expect(columnNames(page.host)).toEqual(['资产', '最新', '15m', '1h', '24h', '7d'])
      // 状态行是表头下面的第一行，横跨所有数据列。
      const firstBodyRow = table.querySelector('tbody tr')!
      expect(firstBodyRow.getAttribute('data-channel-state')).toBeNull()
      expect(firstBodyRow.closest('tbody')?.getAttribute('data-channel-state')).toBe('unavailable')
      const stateCell = firstBodyRow.querySelector<HTMLTableCellElement>('td')!
      expect(Number(stateCell.getAttribute('colspan'))).toBe(1 + 1 + 4)
      expect(stateCell.querySelector('.mi-source-state[data-state="unreadable"]')).not.toBeNull()
      // 行位仍在（每一行都画得出名字）。
      expect(table.querySelectorAll('tr[data-status-row]')).toHaveLength(7)
      // 表里不再有**动作**按钮（日频表头那颗 ⓘ 是说明，不算动作）：这一张卡的动作只剩标题行那一颗。
      const tableActions = [...table.querySelectorAll('button')]
        .map(button => button.textContent ?? '')
        .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))
      expect(tableActions).toHaveLength(0)
      const actions = [...page.host.querySelectorAll('button')]
        .map(button => button.textContent ?? '')
        .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))
      expect(actions).toEqual(['再试一次'])
      // 图区不再整块换成提示（那会是第二颗「再试一次」）。
      expect(page.host.querySelector('[data-cross-asset-region="chart"] .state-view')).toBeNull()
    } finally { vi.useRealTimers(); await page.unmount() }
  })

  it('keeps the restart exit for a version mismatch, and does not add a retry that cannot work', async () => {
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), queryFailure: 'contract' })
    try {
      // 版本不一致：表头照留，状态行说清是版本问题。
      expect(page.host.querySelectorAll('.mi-cross-asset__status-table thead th')).toHaveLength(6)
      const stateRow = page.host.querySelector('tbody[data-channel-state="unavailable"] td')!
      expect(stateRow.textContent).toContain(text.contractMismatch)
      // 重试治不了它：标题行不给「再试一次」，图区那颗「重启应用」还在。
      const retries = [...page.host.querySelectorAll('button')]
        .map(button => button.textContent ?? '')
        .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))
      expect(retries).toHaveLength(0)
      expect(page.host.querySelector('[data-cross-asset-region="chart"] .state-view')).not.toBeNull()
    } finally { await page.unmount() }
  })
})

describe('空态与有数据态同宽：靠结构，不靠像素', () => {
  it('renders the same card, table and header containers in both states', async () => {
    const withData = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs) })
    const structure = (host: HTMLElement) => ({
      card: host.querySelector('.mi-cross-asset') !== null,
      quote: host.querySelector('[data-cross-asset-region="status"]') !== null,
      table: host.querySelector('.mi-cross-asset__status-table') !== null,
      head: host.querySelector('.mi-cross-asset__status-table thead') !== null,
      rows: host.querySelectorAll('tr[data-status-row]').length
    })
    const data = structure(withData.host)
    await withData.unmount()

    const allUnreadable = {
      index: 'unreadable' as const, btc: 'unreadable' as const, eth: 'unreadable' as const,
      dxy: 'unreadable' as const, gold: 'unreadable' as const, us10y: 'unreadable' as const, realRate: 'unreadable' as const
    }
    const empty = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs), rowStates: allUnreadable })
    const none = structure(empty.host)
    await empty.unmount()

    // 容器链一致：没数据时不多包一层、也不换成一块状态面——所以宽度由同一套盒子决定。
    expect(none.card).toBe(data.card)
    expect(none.quote).toBe(data.quote)
    expect(none.table).toBe(data.table)
    expect(none.head).toBe(data.head)
    expect(none.rows).toBe(data.rows)
  })

  it('keeps the row ⓘ on the same line as the row name, never as its own line', async () => {
    // 用户 2026-11-18：「icon 为啥要换行？放到标题前面或者后面去呀」。判据只认结构 + 样式规则：
    // 名字与 ⓘ 同一个 nowrap 容器、图标 flex:none；不许靠 flex-end / margin-left:auto 推走。
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css'), 'utf8')
    const at = css.indexOf('.mi-cross-asset__status-table tbody th .mi-cross-asset__row-name {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toContain('display: inline-flex')
    expect(rule).toContain('align-items: center')
    expect(rule).toContain('flex-wrap: nowrap')
    expect(rule).toContain('gap: 4px')
    expect(rule).not.toContain('flex-end')
    expect(rule).not.toContain('margin-left: auto')
    const iconAt = css.indexOf('.mi-cross-asset__status-table tbody th .mi-cross-asset__row-name > * {')
    expect(css.slice(iconAt, css.indexOf('}', iconAt))).toContain('flex: none')

    // 结构：图标与名字同一组、不是裸兄弟，且**排在名字前面**（用户 2026-11-18：「放标题前面试试看」）。
    const page = await render({ nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs) })
    try {
      for (const id of ['index', 'btc', 'eth', 'dxy'] as const) {
        const th = page.host.querySelector(`[data-status-row="${id}"] th`)!
        const group = th.querySelector('.mi-cross-asset__row-name')!
        expect(group.querySelector('button[aria-label]')).not.toBeNull()
        expect(th.querySelector(':scope > button')).toBeNull()
        expect(group.firstElementChild?.querySelector('button[aria-label]')).not.toBeNull()
      }
      // 壳层那条同名 `.icon-button` 的描边被本卡按回无边框（否则每颗 ⓘ 都像一枚小方块）。
      expect(css).toContain('.mi-cross-asset__row-name .icon-button { border: 0; background: transparent; }')
    } finally { await page.unmount() }
  })

  it('pins the card width in CSS and never derives it from content', () => {
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css'), 'utf8')
    const block = css.slice(css.indexOf('.mi-cross-asset {'), css.indexOf('}', css.indexOf('.mi-cross-asset {')))
    expect(block).toContain('width: 100%')
    expect(block).toContain('min-width: 0')
    expect(css).not.toMatch(/fit-content|inline-grid/)
  })
})

describe('来源状态表沿用上一次读数时的标注', () => {
  it('shows the short stale label once, and rows keep reading (no per-row unreadable)', async () => {
    const page = await render({
      nowMs: overnightMs, feed: 'ready', bySymbol: bothLegs(overnightMs),
      sourceStatusStale: '来源状态：上一次成功的读数 · 08:00'
    })
    try {
      expect(page.host.querySelectorAll('[data-source-status-stale]')).toHaveLength(1)
      expect(page.host.textContent).toContain('上一次成功的读数')
      // 行照常出数，没有逐行「读不到」。
      expect(page.host.querySelectorAll('tr[data-source-state]')).toHaveLength(0)
      expect(page.host.querySelector('[data-status-row="btc"]')).not.toBeNull()
    } finally { await page.unmount() }
  })
})
