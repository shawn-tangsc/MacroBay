import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import {
  divergenceUnavailable,
  isCanonicalDivergenceTime,
  isMarketDivergenceResult,
  type MarketDivergenceResult
} from '../../../contracts/marketDivergence'

/**
 * The renderer's only door to the cross-panel reading.
 *
 * Validated by the same contract function the IPC handler uses, so a shape one side accepts
 * cannot become a blank card on the other.
 */
export const marketDivergenceClient = {
  async query(input: Readonly<{ asOf: string; mode?: 'rules' | 'judge'; force?: boolean }>): Promise<MarketDivergenceResult> {
    try {
      if (!isCanonicalDivergenceTime(input.asOf)) return divergenceUnavailable()
      const value = await window.platform?.products?.invoke(
        'market-intelligence',
        INTELLIGENCE_PUBLIC_QUERY_METHODS.queryMarketDivergence,
        {
          asOf: input.asOf,
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.force ? { force: true } : {})
        }
      )
      return isMarketDivergenceResult(value, input.asOf) ? value : divergenceUnavailable()
    } catch {
      return divergenceUnavailable()
    }
  }
}

export type MarketDivergenceClient = typeof marketDivergenceClient
