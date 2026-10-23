import { macroMarketBackfillBars, macroMarketHistoryIsThin } from './macroMarketReturns'
import {
  realMarketApiPolicy, realMarketApiBackfillNote, realMarketApiDeepBackfillNote, type RealMarketApiFailureCode
} from './realMarketApiPolicy'
import { realMarketApiDxyRequestPlan } from './realMarketApiRequestPlan'
import type { RealMarketApiTransport } from './realMarketApiTransport'
import {
  parseRealMarketApiCandles, parseRealMarketApiPrice, realMarketApiCandleUrl, realMarketApiPriceUrl, type RealMarketApiPoint
} from './realMarketApiTimeSeries'
import type { MacroMarketPoint, MacroMarketStore } from './macroMarketStore'

/** The transport contract stays exported here: the collectors are what consume it. */
export type { RealMarketApiTransport }

/** One instrument the provider refused, while the tick's other instruments still answered. */
export type RealMarketApiSymbolFailure = Readonly<{ symbolCode: string; failureCode: RealMarketApiFailureCode }>

export type RealMarketApiCollectionResult =
  | Readonly<{ state: 'stored' | 'unchanged'; plan: 'latest' | 'backfill'; added: number; credits: number; series: readonly string[]
      /** Present only when some instrument failed and another still wrote: a partial tick. */
      failures?: readonly RealMarketApiSymbolFailure[] }>
  | Readonly<{ state: 'idle'; credits: 0 }>
  | Readonly<{ state: 'unavailable'; failureCode: RealMarketApiFailureCode; credits: number }>

function numberNote(store: MacroMarketStore, key: string): number | undefined {
  const raw = store.readNote(key)
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Whether one series also pulls history on this tick.
 *
 * Per series, and measured by its stored span rather than by a count: a fresh instrument needs its
 * window pulled even while the other one already has one, and the six-hour retry belongs to the series
 * that is still short — not to the tick.
 */
function seriesNeedsBackfill(store: MacroMarketStore, seriesId: string, atMs: number): boolean {
  if (!macroMarketHistoryIsThin(store, seriesId)) return false
  const lastBackfillAtMs = numberNote(store, realMarketApiBackfillNote(seriesId))
  return lastBackfillAtMs === undefined || atMs - lastBackfillAtMs >= realMarketApiPolicy.backfillRetryMs
}

/**
 * The one-time deep backfill: every rung of the ladder, asked in order, and what each one answered.
 *
 * Unlike the ordinary backfill this is best-effort by design. A rung that fails is recorded and the
 * next one is still asked, because the tick's first duty is the level the price leg already holds: a
 * provider refusing four-hourly bars is a reason to have no deep history, never a reason to throw away
 * a fresh dollar level. `evidence` is written to the store as it is, one `TIME:rows` per rung, so the
 * provider's real page size is a fact in the database rather than an assumption in this comment.
 */
type DeepBackfillResult = Readonly<{ points: readonly RealMarketApiPoint[]; credits: number; evidence: string }>

/** One instrument's tick, all-or-nothing: a leg this product cannot read leaves that series untouched. */
type SymbolTick =
  | Readonly<{ state: 'ok'; points: readonly MacroMarketPoint[]; seriesId: string; backfilled: boolean; credits: number }>
  | Readonly<{ state: 'failed'; symbolCode: string; failureCode: RealMarketApiFailureCode; credits: number }>

/**
 * One tick of the macro-market provider.
 *
 * Every instrument in the policy's symbol table is read on its own: its price leg, and its history leg
 * when that series is still too short to answer the longest window. The legs of **one** instrument are
 * all-or-nothing — a level stored beside a history nobody could read is the mistake the first version
 * of this collector made — but one instrument's refusal does not take the other's tick down with it: a
 * second symbol that the plan does not carry must not cost the reader the dollar.
 *
 * `observedAtMs` is when this product read the provider, and `atMs` is the provider's own bar stamp:
 * the level belongs to the provider's clock, the observation belongs to ours.
 */
export function createRealMarketApiCollector(deps: Readonly<{
  transport: RealMarketApiTransport
  store: MacroMarketStore
  credentials: () => Promise<string | undefined>
  now?: () => number
}>) {
  const now = deps.now ?? Date.now

  function pointsOf(points: readonly RealMarketApiPoint[], seriesId: string, atMs: number): MacroMarketPoint[] {
    return points.map(point => ({ series: seriesId, atMs: point.atMs, value: point.value, observedAtMs: atMs }))
  }

  /** The ladder of time frames, once. Rungs are independent: one refusal does not cancel the others. */
  async function deepBackfill(apiKey: string, symbolCode: string, seriesId: string, atMs: number): Promise<DeepBackfillResult> {
    const points: RealMarketApiPoint[] = []
    const evidence: string[] = []
    let credits = 0
    for (const step of realMarketApiPolicy.deepBackfill.steps) {
      const response = await deps.transport(realMarketApiCandleUrl(apiKey, symbolCode, step.timeFrame, macroMarketBackfillBars(step.barMs)))
      credits += 1
      if (response.state === 'unavailable') { evidence.push(`${step.timeFrame}:0`); continue }
      const page = parseRealMarketApiCandles(response.body, response.status, symbolCode)
      if (page.state === 'unavailable') { evidence.push(`${step.timeFrame}:0`); continue }
      points.push(...pointsOf(page.points, seriesId, atMs))
      const first = page.points[0]!
      const last = page.points[page.points.length - 1]!
      evidence.push(`${step.timeFrame}:${page.points.length}/${Math.round((last.atMs - first.atMs) / 3_600_000)}h`)
    }
    return { points, credits, evidence: evidence.join(' ') }
  }

  /**
   * One instrument: price first, then its history.
   *
   * `thin` and `backfill` are separate facts on purpose. `backfill` is the ordinary page and carries a
   * six-hour retry, so a store that was repaired a minute ago does not ask for a week on every tick.
   * The one-time ladder is not that: it is owed by any series that is still short and has never been
   * deepened, and gating it behind the retry is what left the week missing on a profile whose gate an
   * older build had just armed.
   */
  async function collectSymbol(
    apiKey: string, symbolCode: string, seriesId: string, atMs: number,
    history: Readonly<{ thin: boolean; backfill: boolean }>
  ): Promise<SymbolTick> {
    let credits = 0
    const latestResponse = await deps.transport(realMarketApiPriceUrl(apiKey, symbolCode))
    credits += 1
    if (latestResponse.state === 'unavailable') return { state: 'failed', symbolCode, failureCode: latestResponse.failureCode, credits }
    const latest = parseRealMarketApiPrice(latestResponse.body, latestResponse.status, symbolCode)
    if (latest.state === 'unavailable') return { state: 'failed', symbolCode, failureCode: latest.failureCode, credits }
    let points = pointsOf(latest.points, seriesId, atMs)
    // The repair first, and only once: while it has never run for this series, the history is deepened
    // by the ladder rather than by the ordinary single-time-frame page.
    if (history.thin && deps.store.readNote(realMarketApiDeepBackfillNote(seriesId, 'ranAtMs')) === undefined) {
      const deep = await deepBackfill(apiKey, symbolCode, seriesId, atMs)
      credits += deep.credits
      points = [...points, ...pointsOf(deep.points, seriesId, atMs)]
      deps.store.note(realMarketApiDeepBackfillNote(seriesId, 'evidence'), deep.evidence)
      // Written whatever the rungs answered: a ladder that came back empty is a result, not a reason to
      // ask the same eight requests again every six hours.
      deps.store.note(realMarketApiDeepBackfillNote(seriesId, 'ranAtMs'), String(atMs))
      return { state: 'ok', points, seriesId, backfilled: true, credits }
    }
    if (history.backfill) {
      const candleResponse = await deps.transport(realMarketApiCandleUrl(apiKey, symbolCode))
      credits += 1
      if (candleResponse.state === 'unavailable') return { state: 'failed', symbolCode, failureCode: candleResponse.failureCode, credits }
      const candles = parseRealMarketApiCandles(candleResponse.body, candleResponse.status, symbolCode)
      if (candles.state === 'unavailable') return { state: 'failed', symbolCode, failureCode: candles.failureCode, credits }
      points = [...points, ...pointsOf(candles.points, seriesId, atMs)]
    }
    return { state: 'ok', points, seriesId, backfilled: history.backfill, credits }
  }

  async function run(atMs: number = now(), options: Readonly<{ force?: boolean }> = {}): Promise<RealMarketApiCollectionResult> {
    const plan = realMarketApiDxyRequestPlan(atMs, { lastRunAtMs: numberNote(deps.store, realMarketApiPolicy.notes.lastRunAtMs) }, options)
    if (plan === 'idle') return { state: 'idle', credits: 0 }
    const apiKey = await deps.credentials()
    // A missing key is a failure like any other and is recorded like one. Returning here silently was
    // how four ticks reported "completed" while storing nothing, spending nothing and leaving no
    // trace: the reader saw only the synthesised fallback with no reason attached to it.
    if (!apiKey) return fail('credential-missing', 0)
    let credits = 0
    const points: MacroMarketPoint[] = []
    const series: string[] = []
    const failures: RealMarketApiSymbolFailure[] = []
    let backfilled = false
    for (const instrument of realMarketApiPolicy.symbols) {
      const seriesId = realMarketApiPolicy.series[instrument.series]
      const tick = await collectSymbol(apiKey, instrument.symbolCode, seriesId, atMs, {
        thin: macroMarketHistoryIsThin(deps.store, seriesId),
        backfill: seriesNeedsBackfill(deps.store, seriesId, atMs)
      })
      credits += tick.credits
      if (tick.state === 'failed') {
        failures.push({ symbolCode: tick.symbolCode, failureCode: tick.failureCode })
        continue
      }
      points.push(...tick.points)
      series.push(tick.seriesId)
      if (tick.backfilled) {
        backfilled = true
        deps.store.note(realMarketApiBackfillNote(tick.seriesId), String(atMs))
      }
    }
    // Nothing but failures is not a tick: the reader is told the provider's own reason, and no note
    // claims a run that stored nothing.
    if (series.length === 0) return fail(failures[0]?.failureCode ?? 'response-invalid', credits)
    const appended = deps.store.append(points)
    if (appended.state === 'invalid-input') return fail('response-invalid', credits)
    // Every tick that read something is written down, including a tick whose other instrument failed:
    // the cadence is armed by what actually arrived, and the failure is left where it can be read.
    deps.store.note(realMarketApiPolicy.notes.lastRunAtMs, String(atMs))
    deps.store.note(realMarketApiPolicy.notes.lastPlan, backfilled ? 'backfill' : 'latest')
    if (failures.length > 0) {
      deps.store.note(realMarketApiPolicy.notes.lastFailureCode, failures[0]!.failureCode)
      deps.store.note(realMarketApiPolicy.notes.lastSymbolFailures, failures.map(entry => `${entry.symbolCode}:${entry.failureCode}`).join(','))
    }
    return {
      state: appended.state === 'stored' ? 'stored' : 'unchanged', plan: backfilled ? 'backfill' : 'latest',
      added: appended.added, credits, series,
      ...(failures.length > 0 ? { failures: Object.freeze(failures) } : {})
    }
  }

  /** A failure is recorded as a code — never as a URL, and never as a key — and nothing is written. */
  function fail(failureCode: RealMarketApiFailureCode, credits: number): RealMarketApiCollectionResult {
    deps.store.note(realMarketApiPolicy.notes.lastFailureCode, failureCode)
    return { state: 'unavailable', failureCode, credits }
  }

  return { run }
}
