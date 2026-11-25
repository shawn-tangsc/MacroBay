import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  type SentimentOptionsCardQueryInput,
  type SentimentOptionsCardResult
} from '../../../contracts/intelligenceQueryContracts'
import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'

const productId = 'market-intelligence'

export type IntelligenceSentimentOptionsCardClient = {
  query: (input: SentimentOptionsCardQueryInput) => Promise<SentimentOptionsCardResult>
}

export const intelligenceSentimentOptionsCardClient: IntelligenceSentimentOptionsCardClient = {
  async query(input) {
    try {
      if (!isCanonicalFearGreedSnapshotTime(input.asOf) || !input.timeZone) return fallback(input)
      return sanitize(await window.platform?.products?.invoke(productId, INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentOptionsCard, {
        asOf: input.asOf,
        timeZone: input.timeZone,
        windowDays: input.windowDays
      }), input)
    } catch {
      return fallback(input)
    }
  }
}

function sanitize(value: unknown, input: SentimentOptionsCardQueryInput): SentimentOptionsCardResult {
  const record = value as Record<string, unknown> | undefined
  if (!record || record.asOf !== input.asOf || record.timeZone !== input.timeZone || record.windowDays !== input.windowDays) return fallback(input)
  const fearGreed = record.fearGreed as { state?: unknown } | undefined
  const optionSkew = record.optionSkew as { state?: unknown } | undefined
  if (!fearGreed || !optionSkew || typeof fearGreed.state !== 'string' || typeof optionSkew.state !== 'string') return fallback(input)
  return value as SentimentOptionsCardResult
}

function fallback(input: SentimentOptionsCardQueryInput): SentimentOptionsCardResult {
  return {
    asOf: input.asOf,
    windowDays: input.windowDays,
    timeZone: input.timeZone,
    fearGreed: { state: 'unavailable', failureCode: fearGreedSnapshotPolicy.unavailableFailureCode },
    optionSkew: { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
  }
}