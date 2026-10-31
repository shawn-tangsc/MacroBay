import type { BriefingMarketRow, BriefingPulseRow, FactImportance } from '../../../contracts/dailyBriefing'
import { buildMarketPulseRows } from '../../../contracts/marketPulse'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

const reading: FactImportance = Object.freeze({ tier: 'must', source: 'rule', reasonCode: 'reading' })
const gap: FactImportance = Object.freeze({ tier: 'must', source: 'rule', reasonCode: 'gap' })
const context: FactImportance = Object.freeze({ tier: 'support', source: 'rule', reasonCode: 'context' })

const marketStaleAfterMs = 6 * 60 * 60 * 1_000
const dailyStaleAfterMs = 4 * 24 * 60 * 60 * 1_000

export type BriefingReadingRows = Readonly<{
  market: readonly BriefingMarketRow[]
  funds: readonly BriefingPulseRow[]
  fearGreed: BriefingPulseRow | null
}>

export function buildBriefingReadingRows(packet: DailyBriefingFactPacket): BriefingReadingRows {
  const pulses = buildMarketPulseRows({
    asOf: packet.asOf,
    enabled: packet.enabled,
    fearGreed: packet.readings.fearGreed,
    funding: packet.readings.funding,
    capital: packet.readings.capital
  })
  const mapped = pulses.map(toPulseRow)
  const fearGreed = mapped.find((row) => row.id === 'fear-greed') ?? null
  return Object.freeze({
    market: Object.freeze(buildMarketRows(packet)),
    funds: Object.freeze(mapped.filter((row) => row.id !== 'fear-greed')),
    fearGreed
  })
}

function toPulseRow(row: ReturnType<typeof buildMarketPulseRows>[number]): BriefingPulseRow {
  const isGap = row.state === 'unavailable' || row.state === 'source-disabled'
  return Object.freeze({
    id: row.id as BriefingPulseRow['id'],
    group: row.id === 'fear-greed' ? 'sentiment' : 'funds',
    labelKey: row.labelKey,
    importance: isGap ? gap : reading,
    state: row.state,
    value: row.value ? Object.freeze({ number: row.value.number, format: row.value.format }) : null,
    change: row.change ? Object.freeze({ ...row.change }) : null,
    ...(row.changeReason ? { changeReason: row.changeReason } : {}),
    window: row.window,
    observedAt: row.observedAt,
    ...(row.reason ? { reason: row.reason } : {})
  })
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
    crossRow('btc', 'dailyBriefing.row.btc', cross, packet.asOf, { must: true, reason: 'largest-move' }),
    crossRow('eth', 'dailyBriefing.row.eth', cross, packet.asOf, { must: true, reason: 'largest-move' }),
    crossRow('index', 'dailyBriefing.row.index', cross, packet.asOf, { must: false, reason: 'context' }),
    macroRow('dxy', dxy?.synthetic ? 'dailyBriefing.row.dxySynthetic' : 'dailyBriefing.row.dxy', dxy, packet.asOf),
    macroRow('gold', 'dailyBriefing.row.gold', gold, packet.asOf),
    ratesRow('us10y', 'dailyBriefing.row.us10y', tenYear, packet.asOf),
    ratesRow('us10y-real', 'dailyBriefing.row.us10yReal', realTenYear, packet.asOf)
  ]
}

function crossRow(
  id: 'btc' | 'eth' | 'index',
  labelKey: string,
  snapshot: DailyBriefingFactPacket['market']['crossAsset'],
  asOf: string,
  tier: Readonly<{ must: boolean; reason: 'largest-move' | 'context' }>
): BriefingMarketRow {
  const metric = snapshot?.closedReturns[id]?.['24h']
  const importance: FactImportance = Object.freeze({
    tier: tier.must ? 'must' : 'support',
    source: 'rule',
    reasonCode: tier.must ? 'largest-move' : 'context'
  })
  if (snapshot && metric?.state === 'available') {
    const stale = age(asOf, snapshot.analysisEnd) > marketStaleAfterMs
    return Object.freeze({
      id, labelKey, importance, state: stale ? 'stale' as const : 'available' as const,
      value: Object.freeze({ number: normalize(metric.value), format: 'percent' as const }),
      change: null, window: '24h' as const, observedAt: snapshot.analysisEnd
    })
  }
  if (!snapshot) {
    return Object.freeze({
      id, labelKey, importance: tier.must ? gap : context, state: 'unavailable' as const,
      value: null, change: null, window: '24h' as const, observedAt: null, reason: 'query-failed' as const
    })
  }
  // The 24h pair is unavailable here; keep any persisted curve/last close.
  {
    // The panel may have a readable curve or a last closed bar even when the exact 24h pair is
    // missing. Keep that persisted reading instead of turning the whole row into "unavailable".
    const curve = [...(snapshot.curves[id] ?? [])].reverse().find((point) => typeof point.returnPercent === 'number')
    if (curve) {
      return Object.freeze({
        id, labelKey, importance: tier.must ? gap : context, state: 'stale' as const,
        value: Object.freeze({ number: normalize(curve.returnPercent!), format: 'percent' as const }),
        change: null, window: '24h' as const, observedAt: snapshot.analysisEnd, reason: 'stale-fallback' as const
      })
    }
    const last = snapshot.lastClosed?.[id]
    if (last) {
      return Object.freeze({
        id, labelKey, importance: tier.must ? gap : context, state: 'stale' as const,
        value: Object.freeze({ number: normalize(Number(last.close)), format: 'level' as const }),
        change: null, window: 'latest' as const, observedAt: last.at, reason: 'stale-fallback' as const
      })
    }
    return Object.freeze({
      id, labelKey, importance: tier.must ? gap : context, state: 'unavailable' as const,
      value: null, change: null, window: '24h' as const, observedAt: null, reason: 'query-failed' as const
    })
  }
}

function macroRow(
  id: 'dxy' | 'gold',
  labelKey: string,
  reading: { level: number; atMs: number; returns?: Readonly<Partial<Record<string, number>>> } | undefined,
  asOf: string
): BriefingMarketRow {
  if (!reading || !Number.isFinite(reading.level)) {
    return Object.freeze({
      id, labelKey, importance: context, state: 'unavailable' as const,
      value: null, change: null, window: '24h' as const, observedAt: null, reason: 'query-failed' as const
    })
  }
  const observedAt = new Date(reading.atMs).toISOString()
  const stale = age(asOf, observedAt) > marketStaleAfterMs
  const value = reading.returns?.['24h']
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Object.freeze({
      id, labelKey, importance: context, state: stale ? 'stale' as const : 'available' as const,
      value: Object.freeze({ number: normalize(value), format: 'percent' as const }),
      change: null, window: '24h' as const, observedAt
    })
  }
  // The stored history answered the as-of level but not its 24h window. Printing the level keeps the
  // fact the conclusion cites; a dash here would say "no data" about a number that is in hand.
  return Object.freeze({
    id, labelKey, importance: context, state: stale ? 'stale' as const : 'available' as const,
    value: Object.freeze({ number: normalize(reading.level), format: 'level' as const }),
    change: null, window: 'latest' as const, observedAt
  })
}

function ratesRow(
  id: 'us10y' | 'us10y-real',
  labelKey: string,
  reading: { actual: number; previous?: number; period: string } | undefined,
  asOf: string
): BriefingMarketRow {
  if (!reading || !Number.isFinite(reading.actual)) {
    return Object.freeze({
      id, labelKey, importance: context, state: 'unavailable' as const,
      value: null, change: null, window: 'daily' as const, observedAt: null, reason: 'query-failed' as const
    })
  }
  const observedAt = `${reading.period}T00:00:00.000Z`
  const stale = age(asOf, observedAt) > dailyStaleAfterMs
  return Object.freeze({
    id, labelKey, importance: context, state: stale ? 'stale' as const : 'available' as const,
    value: Object.freeze({ number: normalize(reading.actual), format: 'yield' as const }),
    change: reading.previous === undefined
      ? null
      : Object.freeze({ value: normalize(Math.round((reading.actual - reading.previous) * 100 * 100) / 100), unit: 'bp' as const, window: 'daily' as const }),
    window: 'daily' as const, observedAt
  })
}

function age(asOf: string, observedAt: string): number {
  const now = Date.parse(asOf)
  const then = Date.parse(observedAt)
  return Number.isFinite(now) && Number.isFinite(then) ? now - then : Number.POSITIVE_INFINITY
}

function normalize(value: number): number {
  return Object.is(value, -0) ? 0 : value
}
