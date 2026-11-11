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
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(CrossAssetObservationPanel, props) })

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
