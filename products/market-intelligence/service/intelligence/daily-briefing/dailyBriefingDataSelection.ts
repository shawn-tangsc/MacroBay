import type {
  BriefingMarketRow,
  BriefingMateriality,
  BriefingMaterialityCode,
  BriefingPulseRow,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import type { MarketPulseRow } from '../../../contracts/marketPulse'

/**
 * Thresholds that decide whether a data fact is allowed into the brief at all.
 *
 * They are product decisions, not display tuning: a 0.4% DXY move or a 4bp ten-year move is context,
 * not a reason to add a line to a three-minute read. Leverage and the policy path are stricter
 * still: below their threshold the row is hidden even if the model asks for it, because a flat open
 * interest or an unchanged rate path has no explanatory power.
 */
export const briefingDataMaterialityPolicy = Object.freeze({
  marketPercent: 1,
  yieldBasisPoints: 5,
  stablecoinDayPercent: 1,
  etfFlowUsd: 50_000_000,
  fundingExtremePercent: 0.03,
  fearGreedExtremeLow: 20,
  fearGreedExtremeHigh: 80,
  openInterestDayPercent: 5,
  policyProbabilityPoints: 5,
  policyMeetingWithinDays: 7
})

export const materiality = (reasonCode: BriefingMaterialityCode): BriefingMateriality =>
  Object.freeze({ material: true, reasonCode })

export const immateriality: BriefingMateriality =
  Object.freeze({ material: false, reasonCode: 'no-material-change' })

export function marketMoveMateriality(
  value: number,
  threshold: number,
  code: BriefingMaterialityCode
): BriefingMateriality {
  return Math.abs(value) >= threshold ? materiality(code) : immateriality
}

/** The six readings: a score extreme, a supply shift, an ETF flow or a funding extreme. */
export function pulseRowMateriality(id: BriefingPulseRow['id'], row: MarketPulseRow): BriefingMateriality {
  const value = row.value?.number
  const change = row.change?.value
  switch (id) {
    case 'fear-greed':
      if (typeof value === 'number' && (value <= briefingDataMaterialityPolicy.fearGreedExtremeLow || value >= briefingDataMaterialityPolicy.fearGreedExtremeHigh)) {
        return materiality('sentiment-extreme')
      }
      return immateriality
    case 'stablecoin':
      return typeof change === 'number' && Math.abs(change) >= briefingDataMaterialityPolicy.stablecoinDayPercent
        ? materiality('stablecoin-shift')
        : immateriality
    case 'etf-btc':
    case 'etf-eth':
      return typeof value === 'number' && Math.abs(value) >= briefingDataMaterialityPolicy.etfFlowUsd
        ? materiality('etf-flow')
        : immateriality
    case 'funding-btc':
    case 'funding-eth':
      if (typeof value === 'number' && Math.abs(value) >= briefingDataMaterialityPolicy.fundingExtremePercent) {
        return materiality('funding-extreme')
      }
      // A sign flip inside the 24h window is a positioning change even when neither endpoint is
      // extreme, so it also earns a line.
      if (fundingFlip(value, change)) return materiality('funding-flip')
      return immateriality
  }
}

/**
 * The rate path earns a line only when the probability moved enough, the meeting is close, or the
 * implied outcome changed. A path that says the same thing as yesterday is context, not news.
 */
export function policyPathMateriality(input: Readonly<{
  meetingDate: string
  outcome: string
  previousOutcome?: string
  probabilityChangePp?: number
  windowEnd: string
}>): BriefingMateriality {
  const meeting = Date.parse(input.meetingDate)
  const end = Date.parse(input.windowEnd)
  if (Number.isFinite(meeting) && Number.isFinite(end)) {
    const days = (meeting - end) / 86_400_000
    if (days >= 0 && days <= briefingDataMaterialityPolicy.policyMeetingWithinDays) {
      return materiality('policy-meeting-imminent')
    }
  }
  if (input.previousOutcome !== undefined && input.previousOutcome !== input.outcome) {
    return materiality('policy-path-change')
  }
  if (typeof input.probabilityChangePp === 'number' && Math.abs(input.probabilityChangePp) >= briefingDataMaterialityPolicy.policyProbabilityPoints) {
    return materiality('policy-probability-shift')
  }
  return immateriality
}

/**
 * Open interest that moved 5% in a day or funding that flipped or ran hot is a leverage story; a
 * flat read is not, and the row must not appear just because the fields exist.
 */
export function leverageMateriality(input: Readonly<{
  funding: readonly BriefingPulseRow[]
  openInterestChange24hPct?: Readonly<{ btc?: number; eth?: number }>
}>): BriefingMateriality {
  const funding = (id: 'funding-btc' | 'funding-eth') => input.funding.find((row) => row.id === id)
  const extreme = (['funding-btc', 'funding-eth'] as const).some((id) => {
    const rate = funding(id)?.value?.number
    return typeof rate === 'number' && Math.abs(rate) >= briefingDataMaterialityPolicy.fundingExtremePercent
  })
  if (extreme) return materiality('funding-extreme')
  const flip = (['funding-btc', 'funding-eth'] as const).some((id) => {
    const row = funding(id)
    return fundingFlip(row?.value?.number, row?.change?.value)
  })
  if (flip) return materiality('funding-flip')
  const largest = Math.max(
    Math.abs(input.openInterestChange24hPct?.btc ?? 0),
    Math.abs(input.openInterestChange24hPct?.eth ?? 0)
  )
  if (largest >= briefingDataMaterialityPolicy.openInterestDayPercent) return materiality('open-interest-shift')
  return immateriality
}

/** A funding rate that crossed zero inside the 24h window is a positioning change. */
function fundingFlip(value: number | undefined, change: number | undefined): boolean {
  if (typeof value !== 'number' || typeof change !== 'number' || value === 0) return false
  const anchor = value - change
  return (value > 0 && anchor < 0) || (value < 0 && anchor > 0)
}

/**
 * Baseline visibility before the editor speaks.
 *
 * The floor shows by itself; every other data fact is a candidate that the editor must include. An
 * immaterial fact keeps a hidden baseline with its rule reason, so it can never appear just because
 * a value exists.
 */
export function baselineVisibility(
  verdict: BriefingMateriality,
  floor = false
): Readonly<{ visibility: 'shown' | 'hidden'; visibilityReason?: string }> {
  if (floor) return Object.freeze({ visibility: 'shown' as const })
  if (!verdict.material) return Object.freeze({ visibility: 'hidden' as const, visibilityReason: 'no-material-change' })
  return Object.freeze({ visibility: 'hidden' as const, visibilityReason: 'not-selected' })
}

/** The include/hide decision one editorial pass made for the data region. */
export type BriefingDataSelection = Readonly<{
  include?: readonly string[]
  hidden?: readonly Readonly<{ factId: string; reason: string }>[]
}>

/** Every data fact the editor may name, in reading order. */
export function briefingDataFactIds(document: DailyBriefingDocument): readonly string[] {
  return Object.freeze(briefingDataFactRecords(document).map((record) => record.factId))
}

/**
 * Applies an include/hide decision to the data region.
 *
 * The floor is deterministic: BTC/ETH 24h and every gap/stale/disabled row stay shown. Outside the
 * floor the editor decides, but the rule layer keeps its veto: leverage and the policy path can be
 * included only when their materiality threshold was met, and a hidden row always keeps a reason.
 */
export function selectBriefingDataFacts(
  document: DailyBriefingDocument,
  selection: BriefingDataSelection
): DailyBriefingDocument {
  const include = new Set(selection.include ?? [])
  const hidden = new Map((selection.hidden ?? []).map((entry) => [entry.factId, entry.reason]))
  const rows = <T extends BriefingMarketRow | BriefingPulseRow>(row: T): T => {
    const factId = `data:${row.id}`
    return {
      ...row,
      ...decide(factId, row.importance.tier === 'must', row.materiality, row.visibility, row.visibilityReason, include, hidden, false)
    } as T
  }
  const fearGreed = document.data.sentiment.fearGreed
  const leverage = document.data.leverage
    ? {
        ...document.data.leverage,
        ...decide('data:leverage', document.data.leverage.materiality?.reasonCode === 'gap', document.data.leverage.materiality, document.data.leverage.visibility, document.data.leverage.visibilityReason, include, hidden, true)
      }
    : undefined
  const policyPath = document.data.policyPath
    ? {
        ...document.data.policyPath,
        ...decide('data:policy-path', false, document.data.policyPath.materiality, document.data.policyPath.visibility, document.data.policyPath.visibilityReason, include, hidden, true)
      }
    : undefined
  return Object.freeze({
    ...document,
    data: Object.freeze({
      ...document.data,
      market: Object.freeze(document.data.market.map(rows)),
      funds: Object.freeze(document.data.funds.map(rows)),
      sentiment: Object.freeze({
        ...document.data.sentiment,
        fearGreed: fearGreed ? rows(fearGreed) : null
      }),
      ...(leverage ? { leverage } : {}),
      ...(policyPath ? { policyPath } : {})
    })
  })
}

/** The audit trail: every data fact is either shown or hidden with a reason, never silently dropped. */
export function briefingDataVisibilityAudit(
  document: DailyBriefingDocument
): Readonly<{ shown: readonly string[]; hidden: readonly Readonly<{ factId: string; reason: string }>[] }> {
  const shown: string[] = []
  const hidden: Array<Readonly<{ factId: string; reason: string }>> = []
  for (const record of briefingDataFactRecords(document)) {
    if (record.visibility === 'hidden') {
      hidden.push(Object.freeze({ factId: record.factId, reason: record.visibilityReason ?? 'not-selected' }))
    } else if (record.visibility === 'shown') {
      shown.push(record.factId)
    }
  }
  return Object.freeze({
    shown: Object.freeze(shown),
    hidden: Object.freeze(hidden.map((entry) => Object.freeze(entry)))
  })
}

function decide(
  factId: string,
  floor: boolean,
  verdict: BriefingMateriality | undefined,
  visibility: 'shown' | 'hidden' | undefined,
  visibilityReason: string | undefined,
  include: ReadonlySet<string>,
  hidden: ReadonlyMap<string, string>,
  hardGate: boolean
): Readonly<{ visibility?: 'shown' | 'hidden'; visibilityReason?: string }> {
  if (floor) return Object.freeze({ visibility: 'shown' as const })
  if (hidden.has(factId)) return Object.freeze({ visibility: 'hidden' as const, visibilityReason: hidden.get(factId)! })
  // An editor may lift an immaterial context row when it explains the day. Leverage and the policy
  // path are the exception: below their threshold they are not selectable at all.
  const selectable = !hardGate || verdict?.material !== false
  if (include.has(factId) && selectable) return Object.freeze({ visibility: 'shown' as const })
  if (visibility === undefined) return Object.freeze({})
  return Object.freeze({ visibility, ...(visibilityReason ? { visibilityReason } : {}) })
}

function briefingDataFactRecords(document: DailyBriefingDocument): ReadonlyArray<{
  factId: string
  visibility?: 'shown' | 'hidden'
  visibilityReason?: string
}> {
  return [
    ...document.data.market.map((row) => ({ factId: `data:${row.id}`, ...(row.visibility ? { visibility: row.visibility } : {}), ...(row.visibilityReason ? { visibilityReason: row.visibilityReason } : {}) })),
    ...document.data.funds.map((row) => ({ factId: `data:${row.id}`, ...(row.visibility ? { visibility: row.visibility } : {}), ...(row.visibilityReason ? { visibilityReason: row.visibilityReason } : {}) })),
    ...(document.data.sentiment.fearGreed ? [{
      factId: `data:${document.data.sentiment.fearGreed.id}`,
      ...(document.data.sentiment.fearGreed.visibility ? { visibility: document.data.sentiment.fearGreed.visibility } : {}),
      ...(document.data.sentiment.fearGreed.visibilityReason ? { visibilityReason: document.data.sentiment.fearGreed.visibilityReason } : {})
    }] : []),
    ...(document.data.leverage ? [{
      factId: 'data:leverage',
      ...(document.data.leverage.visibility ? { visibility: document.data.leverage.visibility } : {}),
      ...(document.data.leverage.visibilityReason ? { visibilityReason: document.data.leverage.visibilityReason } : {})
    }] : []),
    ...(document.data.policyPath ? [{
      factId: 'data:policy-path',
      ...(document.data.policyPath.visibility ? { visibility: document.data.policyPath.visibility } : {}),
      ...(document.data.policyPath.visibilityReason ? { visibilityReason: document.data.policyPath.visibilityReason } : {})
    }] : [])
  ]
}
