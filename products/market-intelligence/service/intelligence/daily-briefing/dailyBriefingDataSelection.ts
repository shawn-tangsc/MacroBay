import type {
  BriefingMarketRow,
  BriefingMateriality,
  BriefingMaterialityCode,
  BriefingPulseRow,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import type { MarketPulseRow } from '../../../contracts/marketPulse'

/**
 * Thresholds that decide how much a data fact is emphasised — never whether it appears.
 *
 * They are product decisions, not display tuning: a 0.4% DXY move or a 4bp ten-year move is context,
 * and context is what these thresholds shape. Presence is a fact about the data: a reading with a
 * value is on the page, and a quiet day simply says so.
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
 * Open interest that moved 5% in a day or funding that flipped or ran hot is a leverage story worth
 * emphasising; a flat read is a quiet row, still a row — the block is shown either way.
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
 * Whether a reading appears at all: it does when it has a value to print.
 *
 * The threshold used to decide this, and the result was readings vanishing on a quiet day — data the
 * reader could not find, with nothing on the page saying it existed. Emphasis and detail are what a
 * threshold may decide now; presence is a fact about the data.
 *
 * The first parameter is "is there a reading", not a verdict, so an implementation cannot drift back
 * into "material or not" without changing every caller.
 */
export function baselineVisibility(
  hasReadings: boolean,
  floor = false
): Readonly<{ visibility: 'shown' | 'hidden'; visibilityReason?: string }> {
  if (floor || hasReadings) return Object.freeze({ visibility: 'shown' as const })
  return Object.freeze({ visibility: 'hidden' as const, visibilityReason: 'no-readings' })
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
 * The editor's selection, applied to the data region.
 *
 * Presence is already decided by the rows themselves (a reading is shown when it has a value), so this
 * pass no longer adds or removes rows: the editor's list names what to emphasise and how. It used to
 * suppress rows — leverage and the policy path could not appear below their thresholds even when the
 * editor named them, which is how a block with real data vanished from the page.
 */
export function selectBriefingDataFacts(
  document: DailyBriefingDocument,
  selection: BriefingDataSelection
): DailyBriefingDocument {
  // The editorial pass still produces a list; it can no longer hide a row. Presence is restated here
  // from the rows themselves, so a document built under the old rule cannot carry a stale "hidden"
  // into the page — "有数却没写" was the failure, and a stored flag is how it would come back.
  void selection
  const shown = (..._row: readonly unknown[]): Readonly<{ visibility: 'shown' }> => Object.freeze({ visibility: 'shown' as const })
  return Object.freeze({
    ...document,
    data: Object.freeze({
      ...document.data,
      market: Object.freeze(document.data.market.map((row) => ({ ...row, ...shown(row) }))),
      funds: Object.freeze(document.data.funds.map((row) => ({ ...row, ...shown(row) }))),
      sentiment: Object.freeze({
        ...document.data.sentiment,
        fearGreed: document.data.sentiment.fearGreed ? { ...document.data.sentiment.fearGreed, ...shown(document.data.sentiment.fearGreed) } : null
      }),
      ...(document.data.leverage ? { leverage: { ...document.data.leverage, ...shown(document.data.leverage) } } : {}),
      ...(document.data.policyPath ? { policyPath: { ...document.data.policyPath, ...shown(document.data.policyPath) } } : {})
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

/**
 * The audit keeps the editorial pass's own reasons even though they no longer hide anything: the pass
 * still states why it would have left a row out, and that statement is worth recording.
 */
export function withEditorialReasons(
  audit: ReturnType<typeof briefingDataVisibilityAudit>,
  hiddenData: readonly Readonly<{ factId: string; reason: string }>[]
): ReturnType<typeof briefingDataVisibilityAudit> {
  return { shown: audit.shown, hidden: [...audit.hidden, ...hiddenData] }
}
