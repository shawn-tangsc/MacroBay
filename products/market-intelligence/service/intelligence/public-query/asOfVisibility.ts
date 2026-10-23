import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  type MarketIntelligenceQueryCaveat,
  type MarketIntelligenceTimeBoundQueryInput
} from './queryContracts'

export type NormalizedTimeWindow = {
  asOf: string
  from?: string
  to: string
  lookbackWindowMs?: number
  caveats: MarketIntelligenceQueryCaveat[]
}

function parseIsoTimeMs(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isValidIsoTime(value: string | undefined): value is string {
  return parseIsoTimeMs(value) !== null
}

export function compareIsoTime(left: string | undefined, right: string | undefined): number {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  const leftMs = parseIsoTimeMs(left)
  const rightMs = parseIsoTimeMs(right)
  if (leftMs === null && rightMs === null) return 0
  if (leftMs === null) return 1
  if (rightMs === null) return -1
  return leftMs - rightMs
}

export function isVisibleAsOf(visibleAt: string | undefined, asOf: string): boolean {
  if (!isValidIsoTime(visibleAt) || !isValidIsoTime(asOf)) return false
  return compareIsoTime(visibleAt, asOf) <= 0
}

export function normalizeMaxItems(
  maxItems: unknown,
  defaultValue = 20,
  maxValue = 100
): { value: number; truncated: boolean } {
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) {
    return { value: defaultValue, truncated: false }
  }
  const rounded = Math.max(1, Math.floor(maxItems))
  if (rounded > maxValue) {
    return { value: maxValue, truncated: true }
  }
  return { value: rounded, truncated: false }
}

export function normalizeTimeWindow(input: MarketIntelligenceTimeBoundQueryInput): NormalizedTimeWindow {
  const caveats: MarketIntelligenceQueryCaveat[] = []
  const asOf = input.asOf.trim()
  const explicitFrom = input.from?.trim()
  const explicitTo = input.to?.trim()

  if (!isValidIsoTime(asOf)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
  }

  if (explicitFrom && !isValidIsoTime(explicitFrom)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
  }

  if (explicitTo && !isValidIsoTime(explicitTo)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
  }

  const to = explicitTo && isValidIsoTime(explicitTo) && compareIsoTime(explicitTo, asOf) <= 0 ? explicitTo : asOf

  if (explicitTo && isValidIsoTime(explicitTo) && compareIsoTime(explicitTo, asOf) > 0) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
  }

  let from = explicitFrom && isValidIsoTime(explicitFrom) ? explicitFrom : undefined
  if (from && compareIsoTime(from, to) > 0) {
    from = to
  }

  if (from && input.lookbackWindowMs !== undefined) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.explicitWindowOverrodeLookback)
  } else if (!from && typeof input.lookbackWindowMs === 'number' && input.lookbackWindowMs > 0) {
    const fromMs = Date.parse(to) - input.lookbackWindowMs
    if (Number.isFinite(fromMs)) {
      from = new Date(fromMs).toISOString()
    }
  }

  return {
    asOf,
    from,
    to,
    lookbackWindowMs: input.lookbackWindowMs,
    caveats
  }
}

export function isWithinEventTimeWindow(
  eventTime: string | undefined,
  window: Pick<NormalizedTimeWindow, 'from' | 'to'>
): boolean {
  if (!eventTime?.trim()) return true
  if (!isValidIsoTime(eventTime) || !isValidIsoTime(window.to)) return false
  if (window.from && isValidIsoTime(window.from) && compareIsoTime(eventTime, window.from) < 0) return false
  if (compareIsoTime(eventTime, window.to) > 0) return false
  return true
}

export const VISIBLE_AT = {
  item: (record: { detectedAt: string }) => record.detectedAt,
  revision: (record: { detectedAt: string }) => record.detectedAt,
  impact: (record: { createdAt: string }) => record.createdAt,
  sentimentSignal: (record: { createdAt: string }) => record.createdAt,
  sentimentAggregate: (record: { updatedAt: string }) => record.updatedAt,
  sourceHealth: (record: { updatedAt?: string; lastSuccessAt?: string; lastFailureAt?: string }) =>
    record.updatedAt ?? record.lastSuccessAt ?? record.lastFailureAt ?? '',
  rawRecord: (record: { detectedAt: string }) => record.detectedAt
} as const
