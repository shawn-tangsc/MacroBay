import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type { MacroMarketSnapshotReading, MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroRatesSnapshotView } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { DashboardFeedSourceId, DashboardFeedStatusView } from '../../../contracts/macro/dashboardFeedStatusContracts'
import { crossAssetMacroReading } from '../../features/industry/cross-asset/crossAssetStatusRegistry'
import type { MacroMarketViewState } from '../../features/industry/cross-asset/useMacroMarketSnapshot'
import { projectDashboardMacroSourceState } from './dashboardMacroSourceModel'
import type { productText } from '../../shared/i18n/productText'

/**
 * The 来源状态 strip, one row per feed the board actually reads.
 *
 * The strip used to carry one line for the macro provider, which meant a credentialed source that had
 * no key, was switched off, or had just failed looked exactly like one that was working — while the
 * dollar row quietly answered from the synthesis. Each feed is therefore its own row here, and each
 * row is derived from *the reading that is answering it* rather than from the store's general health:
 *
 * - the dollar row reads `crossAssetMacroReading`, the very function the 市场状态 table uses, so the
 *   strip and the figure it describes can never disagree about whether the level is real or synthesised;
 * - a row that is answering from the synthesis or the proxy says so, in the panel's own tag wording, and
 *   is never reported as 采集正常;
 * - a row whose source is unconfigured or switched off names that reason instead of blaming the network.
 *
 * The strip prints these rows 异常优先: `dashboardFeedStatusHealth.ts` splits them into the one ✓
 * summary line for the feeds that are simply working and the rows that each keep a line of their own.
 */
export type DashboardFeedRowId = 'dollar' | 'gold' | 'rates' | 'index'
export type DashboardFeedRowState =
  | 'loading' | 'ok' | 'unconfigured' | 'configured-disabled' | 'failed'
  | 'stale-fallback' | 'proxy' | 'awaiting-collection' | 'unavailable'

export type DashboardFeedRow = Readonly<{
  id: DashboardFeedRowId
  state: DashboardFeedRowState
  /** The feed answering the row when it is not the preferred one: the synthesis, or the proxy. */
  fallback?: 'synthetic' | 'proxy'
  /** When the answering feed last produced a point. `period` supersedes it on a daily feed. */
  atMs?: number
  /** A daily observation date; a rate row prints 截至 this day rather than a clock time. */
  period?: string
  failureCode?: string
  /** Whose switch and outcome the row's reason came from, so the row can name it. */
  sourceId: DashboardFeedSourceId | 'binance-futures-positioning'
  /** Minutes since the preferred feed's newest point, when the row fell back because it aged out. */
  staleMinutes?: number
  /** The one source the reader can open from this row. */
  manageSourceId: string
}>

export type DashboardFeedInput = Readonly<{
  macroClient: boolean
  macroState: MacroMarketViewState
  macro?: MacroMarketSnapshotView
  rates?: MacroRatesSnapshotView
  /** Whether the cross-asset read is still in flight, so the index row says 加载中 and not 不可用. */
  indexLoading: boolean
  index?: CrossAssetSnapshot
  feed?: DashboardFeedStatusView
}>

export function projectDashboardFeedRows(input: DashboardFeedInput): readonly DashboardFeedRow[] {
  return Object.freeze([
    dollarRow(input), goldRow(input), ratesRow(input), indexRow(input)
  ])
}

/** The macro snapshot's clock, and its readings when it has any. An unavailable answer carries none. */
function macroReadings(macro: MacroMarketSnapshotView | undefined): readonly MacroMarketSnapshotReading[] {
  return macro && macro.state !== 'unavailable' ? macro.readings : []
}

function macroAsOfMs(macro: MacroMarketSnapshotView | undefined): number {
  return macro && macro.state !== 'unavailable' ? Date.parse(macro.asOf) : Number.NaN
}

function sourceStatus(feed: DashboardFeedStatusView | undefined, sourceId: DashboardFeedSourceId) {
  return feed?.state === 'available' ? feed.sources.find(source => source.sourceId === sourceId) : undefined
}

type FeedRowExtra = Readonly<{ sourceId: DashboardFeedRow['sourceId'] }> & Partial<Pick<DashboardFeedRow, 'fallback' | 'atMs' | 'period' | 'failureCode' | 'staleMinutes'>>

function row(id: DashboardFeedRowId, state: DashboardFeedRowState, manageSourceId: string, extra: FeedRowExtra): DashboardFeedRow {
  return Object.freeze({ id, state, manageSourceId, ...extra })
}

/** The reason a row has no reading at all, read from the source's own switch and credential. */
function sourceReasonState(status: Readonly<{ enabled: boolean; hasCredential: boolean; failureCode?: string }> | undefined): DashboardFeedRowState {
  if (!status) return 'unavailable'
  if (!status.hasCredential) return 'unconfigured'
  if (!status.enabled) return 'configured-disabled'
  if (status.failureCode) return 'failed'
  return 'awaiting-collection'
}

/**
 * 美元指数. The reason a level is on the row — and the reason it is not — comes from RealMarketAPI's
 * own switch, credential and last outcome: the facts the store cannot show.
 *
 * 来源的状态先于读数判：**真实那条在行上不代表来源是好的**。源失败/被关掉时行照样要说出来，否则
 * 「行的值看着正常」会被读成「采集正常」——这正是旧版靠"回退到合成"才说得出口的那件事。
 */
function dollarRow(input: DashboardFeedInput): DashboardFeedRow {
  const readings = macroReadings(input.macro)
  const real = readings.find(reading => reading.seriesId === macroMarketSnapshotPublicPolicy.series.dollarIndexReal)
  const chosen = crossAssetMacroReading(readings, 'dxy')
  const status = sourceStatus(input.feed, 'realmarketapi-market')
  const fallback = Object.freeze({
    fallback: 'synthetic' as const, sourceId: 'realmarketapi-market' as const,
    ...(chosen ? { atMs: chosen.atMs } : {})
  })
  if (status && !status.hasCredential) return row('dollar', 'unconfigured', 'realmarketapi-market', fallback)
  if (status && !status.enabled) return row('dollar', 'configured-disabled', 'realmarketapi-market', fallback)
  if (status?.failureCode) return row('dollar', 'failed', 'realmarketapi-market', { ...fallback, failureCode: status.failureCode })
  if (chosen && !chosen.synthetic) return row('dollar', 'ok', 'realmarketapi-market', { atMs: chosen.atMs, sourceId: 'realmarketapi-market' })
  if (chosen?.synthetic) {
    const asOfMs = macroAsOfMs(input.macro)
    const staleMinutes = real && Number.isFinite(asOfMs) ? Math.max(0, Math.round((asOfMs - real.atMs) / 60_000)) : undefined
    return row('dollar', 'stale-fallback', 'realmarketapi-market', { ...fallback, ...(staleMinutes === undefined ? {} : { staleMinutes }) })
  }
  // The store has no dollar point at all: name the source's own state rather than the store's emptiness.
  const reason: DashboardFeedRowState = input.macroState === 'loading' && !status ? 'loading' : sourceReasonState(status)
  return row('dollar', reason, 'realmarketapi-market', {
    sourceId: 'realmarketapi-market', fallback: 'synthetic',
    ...(reason === 'failed' && status?.failureCode ? { failureCode: status.failureCode } : {})
  })
}

/** 黄金. Twelve Data's own switch and credential ride the macro snapshot, so no second read is needed. */
function goldRow(input: DashboardFeedInput): DashboardFeedRow {
  const chosen = crossAssetMacroReading(macroReadings(input.macro), 'gold')
  if (chosen) return row('gold', 'ok', 'twelve-data-market', { sourceId: 'twelve-data-market', atMs: chosen.live?.atMs ?? chosen.atMs })
  const projected = projectDashboardMacroSourceState({ client: input.macroClient, state: input.macroState, ...(input.macro ? { snapshot: input.macro } : {}) })
  const state: DashboardFeedRowState = projected === 'loading' ? 'loading'
    : projected === 'disabled' ? 'configured-disabled'
      : projected === 'credential-missing' ? 'unconfigured'
        : projected === 'unavailable' ? 'unavailable'
          : 'awaiting-collection'
  return row('gold', state, 'twelve-data-market', { sourceId: 'twelve-data-market' })
}

/** 美债利率. A daily FRED close: the row prints the observation date, never "now". */
function ratesRow(input: DashboardFeedInput): DashboardFeedRow {
  const readings = input.rates && input.rates.state !== 'unavailable' ? input.rates.readings : []
  const reading = readings.find(candidate => candidate.seriesId === macroRatesSnapshotPublicPolicy.series.us10y)
  if (reading) return row('rates', 'ok', 'fred-rates-liquidity', { sourceId: 'fred-rates-liquidity', period: reading.period })
  const status = sourceStatus(input.feed, 'fred-rates-liquidity')
  const state = sourceReasonState(status)
  return row('rates', state, 'fred-rates-liquidity', {
    sourceId: 'fred-rates-liquidity',
    ...(state === 'failed' && status?.failureCode ? { failureCode: status.failureCode } : {})
  })
}

/**
 * 跨资产指数. Which leg answers is the snapshot's own decision, and the row repeats it: the licensed
 * index is named as the index, the tokenised perpetual wears the panel's 代理 wording.
 */
function indexRow(input: DashboardFeedInput): DashboardFeedRow {
  const source = input.index?.indexSource
  if (source === 'proxy') return row('index', 'proxy', 'realmarketapi-market', { sourceId: 'binance-futures-positioning', fallback: 'proxy' })
  if (source === 'real') {
    const at = input.index?.lastClosed?.index?.at
    return row('index', 'ok', 'realmarketapi-market', { sourceId: 'realmarketapi-market', ...(at ? { atMs: Date.parse(at) } : {}) })
  }
  if (input.indexLoading) return row('index', 'loading', 'realmarketapi-market', { sourceId: 'binance-futures-positioning' })
  // Neither leg answered. Binance switched off is a reason of its own, not a network failure.
  const state: DashboardFeedRowState = input.index?.sourceState === 'disabled' ? 'configured-disabled' : 'unavailable'
  return row('index', state, 'realmarketapi-market', { sourceId: 'binance-futures-positioning' })
}

/**
 * The row as the reader sees it: the name, the state word, and the reason the row is reading what it
 * is reading. The synthetic and proxy words are the panel's own tags, so one label covers both the
 * figure and the line describing it.
 */
export type DashboardFeedText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['feedStatus']
export type DashboardFeedTags = Readonly<{ synthetic: string; proxy: string; realIndex: string }>

export function dashboardFeedRowText(row: DashboardFeedRow, text: DashboardFeedText, tags: DashboardFeedTags, nowMs: number): Readonly<{ id: DashboardFeedRowId; name: string; state: string; detail: string; status: string; sourceId: string }> {
  const state = text.states[row.state]
  const detail = detailOf(row, text, tags, nowMs)
  // The state word leads the line unless the reason already says it: 「采集正常 · 最近 5 分钟前」 needs
  // both halves, while 「未配置 · 未配置 RealMarketAPI，当前使用合成值」 only stutters.
  const status = !detail ? state : detail.includes(state) ? detail : `${state} · ${detail}`
  return Object.freeze({
    id: row.id, name: text.rowNames[row.id], state, detail, status, sourceId: row.sourceId
  })
}

function detailOf(row: DashboardFeedRow, text: DashboardFeedText, tags: DashboardFeedTags, nowMs: number): string {
  const source = text.sourceNames[row.sourceId]
  const usage = row.fallback === 'synthetic' ? format(text.usage.synthetic, { tag: tags.synthetic })
    : row.fallback === 'proxy' ? format(text.usage.proxy, { tag: tags.proxy })
      : text.usage.none
  switch (row.state) {
    case 'ok': {
      if (row.period) return format(text.detail.asOf, { date: row.period })
      const time = relativeTime(row.atMs, text, nowMs)
      if (!time) return ''
      const recent = format(text.detail.recent, { time })
      return row.id === 'index' ? `${format(text.detail.indexReal, { name: tags.realIndex })} · ${recent}` : recent
    }
    case 'stale-fallback': {
      if (row.staleMinutes === undefined) return format(text.detail.staleFallbackNoPoint, { usage })
      return format(text.detail.staleFallback, { usage, minutes: String(row.staleMinutes) })
    }
    case 'proxy': return format(text.detail.proxyInUse, { usage })
    case 'unconfigured': return format(text.detail.unconfigured, { source, usage })
    case 'configured-disabled': return format(text.detail.disabled, { source, usage })
    case 'failed': return row.failureCode
      ? format(text.detail.failed, { source, usage, code: printableFailureCode(row.failureCode) })
      : format(text.detail.failedNoCode, { source, usage })
    case 'awaiting-collection': return text.detail.awaiting
    case 'unavailable': return text.detail.unavailable
    default: return ''
  }
}

/**
 * A failure is printed as its code and nothing else.
 *
 * The IPC boundary already refuses a payload whose code is not a code, so the row a shipped board
 * renders never holds a URL or a key. This is the second lock: the strip only ever prints codes, so a
 * row handed in from anywhere else drops anything URL-shaped or credential-shaped rather than
 * repeating it, and says its reason is unreadable instead of leaking what the provider sent.
 */
export function printableFailureCode(code: string): string {
  const cleaned = code.trim().replace(/(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S*/gi, '').replace(/\b(?:api[-_]?key|apikey|access[-_]?token|token|secret|bearer)\b\s*[:=]?\s*\S*/gi, '')
  const printable = cleaned.replace(/[\s·,;:]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return printable || 'unreadable'
}

/** A stored point's age, in the reader's own words. Absent or unreadable means no time is printed. */
export function relativeTime(atMs: number | undefined, text: DashboardFeedText, nowMs: number): string | undefined {
  if (atMs === undefined || !Number.isFinite(atMs) || !Number.isFinite(nowMs)) return undefined
  const elapsed = Math.max(0, nowMs - atMs)
  if (elapsed < 60_000) return text.relative.justNow
  if (elapsed < 3_600_000) return format(text.relative.minutes, { count: String(Math.floor(elapsed / 60_000)) })
  if (elapsed < 86_400_000) return format(text.relative.hours, { count: String(Math.floor(elapsed / 3_600_000)) })
  return format(text.relative.days, { count: String(Math.floor(elapsed / 86_400_000)) })
}

function format(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template)
}
