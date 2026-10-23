import { synthesizeDollarIndexSeries } from './dollarIndexSeries'
import { missingDollarIndexTerms } from './dollarIndexSynthesis'
import { macroMarketPolicy, type MacroMarketFailureCode } from './macroMarketPolicy'
import { macroMarketHistoryIsThin } from './macroMarketReturns'
import { macroMarketRequestPlan } from './macroMarketRequestPlan'
import type { MacroMarketPoint, MacroMarketStore } from './macroMarketStore'
import { parseTimeSeries, timeSeriesUrl, type ProviderBar } from './twelveDataTimeSeries'

export type MacroMarketTransport = (url: string) => Promise<
  | Readonly<{ state: 'ok'; status: number; body: unknown }>
  | Readonly<{ state: 'unavailable'; failureCode: MacroMarketFailureCode }>>

export type MacroMarketCollectionResult =
  | Readonly<{ state: 'stored' | 'unchanged'; plan: 'dollar-basket' | 'extras'; added: number; credits: number; series: readonly string[] }>
  | Readonly<{ state: 'idle'; credits: 0 }>
  | Readonly<{ state: 'unavailable'; failureCode: MacroMarketFailureCode; credits: number }>

/**
 * True while the stored history is too short to answer the longest window the wire admits.
 *
 * The span is measured by `macroMarketHistoryIsThin`, not by a point count: the backfill fills a
 * whole window at once, and a market that closes at the weekend stores fewer bars than the calendar
 * implies, so counting would keep asking forever.
 */
function needsBackfill(store: MacroMarketStore, planKind: 'dollar-basket' | 'extras'): boolean {
  // Each cadence measures its own series: the extras were left asking for two bars because only the
  // dollar's history was consulted, so gold, the offshore yuan and the peg stayed two points deep.
  const probe = planKind === 'dollar-basket' ? macroMarketPolicy.series.dollarIndex : macroMarketPolicy.series.gold
  return macroMarketHistoryIsThin(store, probe)
}

function numberNote(store: MacroMarketStore, key: string): number | undefined {
  const raw = store.readNote(key)
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** The series id a provider symbol is stored under. Explicit for the ones the panel names. */
export function seriesIdForSymbol(symbol: string): string {
  const series = macroMarketPolicy.series
  if (symbol === 'XAU/USD') return series.gold
  if (symbol === 'USD/CNH') return series.offshoreYuan
  if (symbol === 'USDT/USD') return series.stablecoinPeg
  return symbol.toLowerCase().replace('/', '-')
}

function newestBar(bars: readonly ProviderBar[], symbol: string): ProviderBar | undefined {
  return bars.filter(bar => bar.symbol === symbol).sort((a, b) => b.atMs - a.atMs)[0]
}

/**
 * One tick: fetch what the clock asks for, store every close, and synthesise the dollar index from
 * the basket when that is what the tick carried.
 *
 * The synthesis is skipped — with the missing terms recorded, not guessed — unless all six
 * currencies are present in the same response.
 */
export function createMacroMarketCollector(deps: Readonly<{
  transport: MacroMarketTransport
  store: MacroMarketStore
  credentials: () => Promise<string | undefined>
  now?: () => number
}>) {
  const now = deps.now ?? Date.now
  async function run(atMs: number = now(), options: Readonly<{ force?: boolean }> = {}): Promise<MacroMarketCollectionResult> {
    const plan = macroMarketRequestPlan(atMs, {
      basketAtMs: numberNote(deps.store, 'lastBasketAtMs'),
      extrasAtMs: numberNote(deps.store, 'lastExtrasAtMs')
    }, options)
    if (plan.kind === 'idle') return { state: 'idle', credits: 0 }
    const apiKey = await deps.credentials()
    if (!apiKey) return { state: 'unavailable', failureCode: 'credential-missing', credits: plan.credits }
    const outputsize = needsBackfill(deps.store, plan.kind) ? macroMarketPolicy.backfillOutputsize : macroMarketPolicy.outputsize
    // The two-bar tick is one request for the whole plan; a backfill of a week is one request per
    // symbol, because the provider truncates a multi-symbol page at that size (one symbol came back)
    // and a credit is spent per symbol either way.
    const requests = outputsize === macroMarketPolicy.backfillOutputsize ? plan.symbols.map(symbol => [symbol]) : [plan.symbols]
    const bars: ProviderBar[] = []
    for (const symbols of requests) {
      const response = await deps.transport(timeSeriesUrl(symbols, apiKey, outputsize))
      if (response.state === 'unavailable') return { state: 'unavailable', failureCode: response.failureCode, credits: plan.credits }
      const parsed = parseTimeSeries(response.body, response.status)
      if (parsed.state === 'unavailable') return { state: 'unavailable', failureCode: parsed.failureCode, credits: plan.credits }
      // Every requested symbol must come back. A page that quietly carries one of six would otherwise
      // be stored as if it were complete — which is how 256 bars of EUR/USD once landed alone.
      const returned = new Set(parsed.bars.map(bar => bar.symbol))
      const absent = symbols.filter(symbol => !returned.has(symbol))
      if (absent.length > 0) {
        deps.store.note('missingSymbols', absent.join(','))
        return { state: 'unavailable', failureCode: 'response-invalid', credits: plan.credits }
      }
      bars.push(...parsed.bars)
    }
    const points: MacroMarketPoint[] = bars.map(bar => ({
      series: seriesIdForSymbol(bar.symbol), atMs: bar.atMs, value: Number(bar.close), observedAtMs: atMs
    }))
    if (plan.kind === 'dollar-basket') {
      // Every bar where all six currencies meet becomes an index point, so the index carries the same
      // history the currencies do.
      const indexSeries = synthesizeDollarIndexSeries(bars)
      if (indexSeries.length === 0) {
        const closes: Record<string, number | undefined> = {}
        for (const symbol of macroMarketPolicy.tickSymbols) {
          const bar = newestBar(bars, symbol)
          closes[symbol] = bar ? Number(bar.close) : undefined
        }
        deps.store.note('missingDollarTerms', missingDollarIndexTerms(closes).join(','))
      }
      for (const point of indexSeries) {
        points.push({ series: macroMarketPolicy.series.dollarIndex, atMs: point.atMs, value: point.value, observedAtMs: atMs })
      }
    }
    const appended = deps.store.append(points)
    if (appended.state === 'invalid-input') return { state: 'unavailable', failureCode: 'response-invalid', credits: plan.credits }
    deps.store.note('lastRunAtMs', String(atMs))
    deps.store.note('lastPlan', plan.kind)
    deps.store.note(plan.kind === 'dollar-basket' ? 'lastBasketAtMs' : 'lastExtrasAtMs', String(atMs))
    deps.store.note('lastOutputsize', String(outputsize))
    deps.store.note('lastCredits', String(plan.credits))
    return {
      state: appended.state === 'stored' ? 'stored' : 'unchanged', plan: plan.kind,
      added: appended.added, credits: plan.credits, series: [...new Set(points.map(point => point.series))]
    }
  }
  return { run }
}
