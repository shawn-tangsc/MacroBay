import type {
  BriefingMarketRow,
  BriefingMateriality,
  BriefingPulseRow,
  BriefingRowCadence,
  BriefingRowChange,
  BriefingValueFormat,
  DailyBriefingReadingState,
  FactImportance
} from '../../../contracts/dailyBriefing'
import { briefingCadencePolicy } from '../../../contracts/dailyBriefing'
import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import { buildMarketPulseRows } from '../../../contracts/marketPulse'
import {
  baselineVisibility,
  briefingDataMaterialityPolicy,
  immateriality,
  marketMoveMateriality,
  materiality as materialVerdict,
  pulseRowMateriality
} from './dailyBriefingDataSelection'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { previousUsEquityTradingDay, tradingSessionsBehind } from '../macro-calendar/tradingDayCalendar'

const gap: FactImportance = Object.freeze({ tier: 'must', source: 'rule', reasonCode: 'gap' })
const context: FactImportance = Object.freeze({ tier: 'support', source: 'rule', reasonCode: 'context' })

const marketStaleAfterMs = briefingCadencePolicy.rolling24hMaxLagMs

/**
 * Which observation calendar each row belongs to.
 *
 * The brief is built every morning; its sources are not. Crypto, stablecoins, funding and open
 * interest trade every hour of every day, so their baseline is a rolling 24 hours. ETF flows, the
 * dollar, gold and the ten-year only print on a US trading day, so their baseline is the last close
 * of the previous *session* — a weekend or a holiday has no new close to be late for. Fear-and-greed
 * is a release: its baseline is the previous publication, on whatever day that landed.
 *
 * The registry is exhaustive over the row ids on purpose: a new row cannot join the brief without
 * someone deciding what "the previous observation" means for it.
 */
export const rowCadence: Readonly<Record<BriefingMarketRow['id'] | BriefingPulseRow['id'], BriefingRowCadence>> = Object.freeze({
  btc: '24h',
  eth: '24h',
  index: '24h',
  dxy: 'trading-day',
  gold: 'trading-day',
  us10y: 'trading-day',
  'us10y-real': 'trading-day',
  'fear-greed': 'publication-day',
  'funding-btc': '24h',
  'funding-eth': '24h',
  stablecoin: '24h',
  'etf-btc': 'trading-day',
  'etf-eth': 'trading-day'
})

/** The previous fear-and-greed publication the move is measured against. */
export type FearGreedBaseline = Readonly<{
  score: number
  /** The instant the compared score was published, never the edition date. */
  publishedAt: string
}>

export type BriefingReadingRows = Readonly<{
  market: readonly BriefingMarketRow[]
  funds: readonly BriefingPulseRow[]
  fearGreed: BriefingPulseRow | null
}>

export function buildBriefingReadingRows(
  packet: DailyBriefingFactPacket,
  previousFearGreed?: FearGreedBaseline
): BriefingReadingRows {
  const pulses = buildMarketPulseRows({
    asOf: packet.asOf,
    enabled: packet.enabled,
    fearGreed: packet.readings.fearGreed,
    funding: packet.readings.funding,
    capital: packet.readings.capital
  })
  const mapped = pulses.map((row) => toPulseRow(row, packet.readings.capital, packet.asOf, previousFearGreed))
  const fearGreed = mapped.find((row) => row.id === 'fear-greed') ?? null
  return Object.freeze({
    market: Object.freeze(buildMarketRows(packet)),
    funds: Object.freeze(mapped.filter((row) => row.id !== 'fear-greed')),
    fearGreed
  })
}

/**
 * Builds one reading row, and the comparisons that explain it.
 *
 * Two rows are read as moves rather than levels: the stablecoin supply (a quarter-trillion level
 * changes slowly, and the day-over-day shift is the story) and fear-and-greed (an index level only
 * means something against the previous publication). Both keep their level in `value` for the
 * caption, keep the move as the headline `change`, and state `no-baseline` when the edition has
 * nothing to compare against — a zero would read as "flat" and is never substituted.
 */
function toPulseRow(
  row: ReturnType<typeof buildMarketPulseRows>[number],
  capital: CapitalConditionsSnapshotResult,
  asOf: string,
  previousFearGreed: FearGreedBaseline | undefined
): BriefingPulseRow {
  const cadence = rowCadence[row.id]
  // A reading outside its expected observation window is a gap: the reader must see that the
  // number is old. A weekend or a market holiday is not outside that window.
  const state = readingRowState(cadence, row, asOf)
  const isGap = state !== 'available'
  const materiality = isGap ? materialVerdict('gap') : pulseRowMateriality(row.id, row)
  const baseline = cadence === 'publication-day' ? previousFearGreed : undefined
  const change = isGap
    ? null
    : cadence === 'publication-day'
      ? publicationChange(row, baseline)
      : row.change ? Object.freeze({ ...row.change }) : null
  const auxiliaryChanges = row.id === 'stablecoin' && change ? stablecoinAuxiliaryChanges(capital) : []
  return Object.freeze({
    id: row.id as BriefingPulseRow['id'],
    group: row.id === 'fear-greed' ? 'sentiment' : 'funds',
    labelKey: row.labelKey,
    importance: isGap ? gap : context,
    materiality,
    ...baselineVisibility(materiality, isGap),
    state,
    value: row.value ? Object.freeze({ number: row.value.number, format: row.value.format }) : null,
    change,
    ...(auxiliaryChanges.length > 0 ? { auxiliaryChanges: Object.freeze(auxiliaryChanges) } : {}),
    ...(change ? {} : row.changeReason ? { changeReason: row.changeReason } : {}),
    window: row.window,
    cadence,
    ...(change && baseline ? { baselineAt: baseline.publishedAt } : {}),
    observedAt: row.observedAt,
    ...(row.reason ? { reason: row.reason } : {})
  })
}

/**
 * Downgrades a stale verdict only when the observation calendar says nothing was due.
 *
 * The ETF source marks a row stale on a wall-clock age, which is wrong on a long holiday weekend:
 * Thursday's close is not stale on Monday if Friday was a holiday — there was no session to print.
 * The calendar answers the real question (how many sessions are missing), and the wall-clock verdict
 * stands when the calendar cannot judge the timestamp.
 */
function readingRowState(
  cadence: BriefingRowCadence,
  row: ReturnType<typeof buildMarketPulseRows>[number],
  asOf: string
): DailyBriefingReadingState {
  if (row.state !== 'stale' || cadence !== 'trading-day' || !row.observedAt) return row.state
  const behind = tradingSessionsBehind(row.observedAt, asOf)
  if (behind === undefined) return row.state
  return behind <= briefingCadencePolicy.tradingDayMaxMissingSessions ? 'available' : row.state
}

/**
 * The fear-and-greed move, measured against the previous *publication*.
 *
 * The source has no daily promise: it publishes when it publishes. So the baseline is the score the
 * last stored edition read, whatever day that was, and the row carries that publication's instant in
 * `baselineAt` so the copy can state the real span instead of calling every move a 1d move. A
 * previous edition that read the same publication is not a second value: subtracting it would print
 * a zero change that means "no new release", not "the index did not move". A missing baseline is
 * `no-baseline`, never zero.
 */
function publicationChange(
  row: ReturnType<typeof buildMarketPulseRows>[number],
  baseline: FearGreedBaseline | undefined
): BriefingRowChange | null {
  const currentScore = row.value?.number
  if (typeof currentScore !== 'number' || !Number.isFinite(currentScore)) return null
  if (!baseline) return null
  if (row.observedAt && baseline.publishedAt >= row.observedAt) return null
  const delta = Math.round(currentScore - baseline.score)
  // A ranking that did not move is still a baseline: report 0 only when both publications are known.
  return Object.freeze({ value: normalize(delta), unit: 'points' as const, window: 'publication-day' as const })
}

/**
 * The longer windows the stablecoin snapshot already measured, for the caption under the 1d move.
 *
 * The snapshot reports a zero delta both for a genuinely flat window and for a window it could not
 * compare, so a zero is dropped rather than printed as a `0.00%` move; the 1d percentage stays the
 * headline either way.
 */
function stablecoinAuxiliaryChanges(capital: CapitalConditionsSnapshotResult): readonly BriefingRowChange[] {
  if (capital.state !== 'available') return []
  const core = capital.coreStablecoins
  const candidates: readonly BriefingRowChange[] = [
    { value: core.change1dUsd, unit: 'usd', window: '1d' },
    { value: core.change7dPercent, unit: 'percent', window: '7d' },
    { value: core.change30dPercent, unit: 'percent', window: '30d' }
  ]
  return candidates
    .filter((change) => Number.isFinite(change.value) && change.value !== 0)
    .map((change) => Object.freeze({ ...change, value: normalize(change.value) }))
}

function buildMarketRows(packet: DailyBriefingFactPacket): readonly BriefingMarketRow[] {
  const cross = packet.market.crossAsset
  const macro = packet.market.macroMarket
  const rates = packet.market.macroRates
  const dxy = macro?.state === 'available' || macro?.state === 'empty'
    ? macro.readings.find((reading) => reading.seriesId === 'dxy-real') ?? macro.readings.find((reading) => reading.seriesId === 'dxy-synthetic')
    : undefined
  const gold = macro?.state === 'available' || macro?.state === 'empty'
    ? macro.readings.find((reading) => reading.seriesId === 'xau-usd')
    : undefined
  const tenYear = rates?.state === 'available' || rates?.state === 'empty'
    ? rates.readings.find((reading) => reading.metricKey === 'US_10Y_YIELD')
    : undefined
  const realTenYear = rates?.state === 'available' || rates?.state === 'empty'
    ? rates.readings.find((reading) => reading.metricKey === 'US_REAL_YIELD_10Y')
    : undefined
  return [
    crossRow('btc', 'dailyBriefing.row.btc', cross, packet.asOf, { must: true, code: 'largest-move' }),
    crossRow('eth', 'dailyBriefing.row.eth', cross, packet.asOf, { must: true, code: 'largest-move' }),
    crossRow('index', 'dailyBriefing.row.index', cross, packet.asOf, { must: false, code: 'index-move' }),
    macroRow('dxy', dxy?.synthetic ? 'dailyBriefing.row.dxySynthetic' : 'dailyBriefing.row.dxy', dxy, packet.asOf, 'fx-move'),
    macroRow('gold', 'dailyBriefing.row.gold', gold, packet.asOf, 'gold-move'),
    ratesRow('us10y', 'dailyBriefing.row.us10y', tenYear, packet.asOf, 'yield-move'),
    ratesRow('us10y-real', 'dailyBriefing.row.us10yReal', realTenYear, packet.asOf, 'yield-move')
  ]
}

function crossRow(
  id: 'btc' | 'eth' | 'index',
  labelKey: string,
  snapshot: DailyBriefingFactPacket['market']['crossAsset'],
  asOf: string,
  rule: Readonly<{ must: boolean; code: BriefingMateriality['reasonCode'] }>
): BriefingMarketRow {
  const metric = snapshot?.closedReturns[id]?.['24h']
  const importance: FactImportance = rule.must
    ? Object.freeze({ tier: 'must', source: 'rule', reasonCode: 'largest-move' })
    : context
  if (snapshot && metric?.state === 'available') {
    const stale = age(asOf, snapshot.analysisEnd) > marketStaleAfterMs
    const materiality = stale ? materialVerdict('gap') : marketMoveMateriality(normalize(metric.value), briefingDataMaterialityPolicy.marketPercent, rule.code)
    return Object.freeze({
      id, labelKey, importance: stale ? gap : importance, materiality, ...baselineVisibility(materiality, rule.must || stale),
      state: stale ? 'stale' as const : 'available' as const,
      value: Object.freeze({ number: normalize(metric.value), format: 'percent' as const }),
      change: null, window: '24h' as const, cadence: '24h' as const, observedAt: snapshot.analysisEnd
    })
  }
  if (!snapshot) {
    return gapRow(id, labelKey, 'query-failed', 'unavailable', null, '24h', null)
  }
  // The 24h pair is unavailable here; keep any persisted curve/last close.
  {
    // The panel may have a readable curve or a last closed bar even when the exact 24h pair is
    // missing. Keep that persisted reading instead of turning the whole row into "unavailable".
    const curve = [...(snapshot.curves[id] ?? [])].reverse().find((point) => typeof point.returnPercent === 'number')
    if (curve) {
      return gapRow(id, labelKey, 'stale-fallback', 'stale', { number: normalize(curve.returnPercent!), format: 'percent' }, '24h', snapshot.analysisEnd)
    }
    const last = snapshot.lastClosed?.[id]
    if (last) {
      return gapRow(id, labelKey, 'stale-fallback', 'stale', { number: normalize(Number(last.close)), format: 'level' }, 'latest', last.at)
    }
    return gapRow(id, labelKey, 'query-failed', 'unavailable', null, '24h', null)
  }
}

function gapRow(
  id: BriefingMarketRow['id'],
  labelKey: string,
  reason: NonNullable<BriefingMarketRow['reason']>,
  state: 'stale' | 'unavailable',
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null,
  window: BriefingMarketRow['window'],
  observedAt: string | null
): BriefingMarketRow {
  // Every gap, stale or missing row keeps the floor: a blank row is the reader's signal that the
  // data is missing, and hiding it would make the brief look complete when it is not.
  const materiality = materialVerdict('gap')
  return Object.freeze({
    id, labelKey, importance: gap, materiality, ...baselineVisibility(materiality, true),
    state, value, change: null, window, cadence: rowCadence[id], observedAt, reason
  })
}

/**
 * The dollar and gold are trading-day rows.
 *
 * Their stored `24h` return is anchored on the newest fifteen-minute bar and compared with the bar a
 * day earlier — at a morning cutoff that is the last session's close against the one before it, i.e.
 * exactly the baseline this cadence names. What the weekend changes is only the *expected* close: on
 * a Sunday the newest bar is Friday's, and Friday's close is not stale simply because it is 40 hours
 * old. The row therefore gaps on missing sessions, never on elapsed hours.
 */
function macroRow(
  id: 'dxy' | 'gold',
  labelKey: string,
  reading: { level: number; atMs: number; returns?: Readonly<Partial<Record<string, number>>> } | undefined,
  asOf: string,
  code: BriefingMateriality['reasonCode']
): BriefingMarketRow {
  if (!reading || !Number.isFinite(reading.level)) {
    return gapRow(id, labelKey, 'query-failed', 'unavailable', null, 'trading-day', null)
  }
  const observedAt = new Date(reading.atMs).toISOString()
  const stale = tradingRowIsStale(observedAt, asOf)
  const value = reading.returns?.['24h']
  if (stale) {
    return gapRow(id, labelKey, 'stale-fallback', 'stale',
      typeof value === 'number' && Number.isFinite(value)
        ? { number: normalize(value), format: 'percent' }
        : { number: normalize(reading.level), format: 'level' },
      typeof value === 'number' ? 'trading-day' : 'latest', observedAt)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const materiality = marketMoveMateriality(normalize(value), briefingDataMaterialityPolicy.marketPercent, code)
    return Object.freeze({
      id, labelKey, importance: context, materiality, ...baselineVisibility(materiality),
      state: 'available' as const,
      value: Object.freeze({ number: normalize(value), format: 'percent' as const }),
      change: null, window: 'trading-day' as const, cadence: 'trading-day' as const, observedAt
    })
  }
  // The stored history answered the as-of level but not its 24h window. Printing the level keeps the
  // fact the conclusion cites; a dash here would say "no data" about a number that is in hand. A
  // level alone is not a change, so it stays a context row.
  return Object.freeze({
    id, labelKey, importance: context, materiality: immateriality, ...baselineVisibility(immateriality),
    state: 'available' as const,
    value: Object.freeze({ number: normalize(reading.level), format: 'level' as const }),
    change: null, window: 'latest' as const, cadence: 'trading-day' as const, observedAt
  })
}

/**
 * The ten-year is a trading-day row whose baseline is the previous session's official close.
 *
 * FRED publishes one close per session and stamps it with that session's date, so `previous` is the
 * prior trading day's close — the baseline the copy names. When FRED has no prior close the row
 * states `no-baseline`; a zero would claim the yield did not move, which is the one thing an absent
 * close cannot say.
 */
function ratesRow(
  id: 'us10y' | 'us10y-real',
  labelKey: string,
  reading: { actual: number; previous?: number; period: string } | undefined,
  asOf: string,
  code: BriefingMateriality['reasonCode']
): BriefingMarketRow {
  if (!reading || !Number.isFinite(reading.actual)) {
    return gapRow(id, labelKey, 'query-failed', 'unavailable', null, 'trading-day', null)
  }
  const observedAt = `${reading.period}T00:00:00.000Z`
  if (tradingRowIsStale(observedAt, asOf)) {
    return gapRow(id, labelKey, 'stale-fallback', 'stale', { number: normalize(reading.actual), format: 'yield' }, 'trading-day', observedAt)
  }
  const changeBp = reading.previous === undefined
    ? undefined
    : normalize(Math.round((reading.actual - reading.previous) * 100 * 100) / 100)
  const priorSession = reading.previous === undefined ? undefined : previousUsEquityTradingDay(reading.period)
  const materiality = typeof changeBp === 'number' && Math.abs(changeBp) >= briefingDataMaterialityPolicy.yieldBasisPoints
    ? materialVerdict(code)
    : immateriality
  return Object.freeze({
    id, labelKey, importance: context, materiality, ...baselineVisibility(materiality),
    state: 'available' as const,
    value: Object.freeze({ number: normalize(reading.actual), format: 'yield' as const }),
    change: changeBp === undefined
      ? null
      : Object.freeze({ value: changeBp, unit: 'bp' as const, window: 'trading-day' as const }),
    ...(changeBp === undefined ? { changeReason: 'no-baseline' as const } : {}),
    window: 'trading-day' as const,
    cadence: 'trading-day' as const,
    ...(priorSession ? { baselineAt: `${priorSession}T00:00:00.000Z` } : {}),
    observedAt
  })
}

/**
 * Whether a trading-day observation is missing sessions it should have printed.
 *
 * The answer is a trading-day count, not an age: consecutive sessions joined by non-trading days do
 * not make a close stale. An unreadable instant falls back to the wall clock so a corrupt timestamp
 * still fails closed.
 */
function tradingRowIsStale(observedAt: string, asOf: string): boolean {
  const behind = tradingSessionsBehind(observedAt, asOf)
  return behind === undefined
    ? age(asOf, observedAt) > marketStaleAfterMs
    : behind > briefingCadencePolicy.tradingDayMaxMissingSessions
}

function age(asOf: string, observedAt: string): number {
  const now = Date.parse(asOf)
  const then = Date.parse(observedAt)
  return Number.isFinite(now) && Number.isFinite(then) ? now - then : Number.POSITIVE_INFINITY
}

function normalize(value: number): number {
  return Object.is(value, -0) ? 0 : value
}
