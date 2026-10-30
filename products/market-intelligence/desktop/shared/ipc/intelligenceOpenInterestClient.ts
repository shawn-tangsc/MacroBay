import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import {
  isCanonicalOpenInterestTime,
  isOpenInterestHistoryResult,
  isOpenInterestWindow,
  openInterestUnavailable,
  type OpenInterestHistoryResult,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'

/**
 * The renderer's only door to the positioning series.
 *
 * The answer is validated by the same contract function the IPC handler uses, so a shape the
 * handler accepts cannot become a blank card here — and a refusal on either side produces the
 * same `unavailable`, never a partial series.
 */
export const intelligenceOpenInterestClient = {
  async query(input: Readonly<{ asOf: string; window: OpenInterestWindow }>): Promise<OpenInterestHistoryResult> {
    try {
      if (!isCanonicalOpenInterestTime(input.asOf) || !isOpenInterestWindow(input.window)) return openInterestUnavailable()
      const value = await window.platform?.products?.invoke(
        'market-intelligence',
        INTELLIGENCE_PUBLIC_QUERY_METHODS.queryOpenInterestHistory,
        { asOf: input.asOf, window: input.window }
      )
      return isOpenInterestHistoryResult(value, input.asOf, input.window) ? value : openInterestUnavailable()
    } catch {
      return openInterestUnavailable()
    }
  }
}

export type IntelligenceOpenInterestClient = typeof intelligenceOpenInterestClient
