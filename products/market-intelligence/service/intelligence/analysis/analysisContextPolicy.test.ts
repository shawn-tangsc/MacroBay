import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_CONTEXT_FACT_BUDGET } from './analysisContextPolicy'

describe('analysisContextPolicy', () => {
  it('holds the fact budget it was moved out of the contract with, value for value', () => {
    expect(MARKET_ANALYSIS_CONTEXT_FACT_BUDGET.maximumMacroFacts).toBe(90)
    expect(MARKET_ANALYSIS_CONTEXT_FACT_BUDGET.minimumFactsPerDomain).toEqual({ default: 6, funding: 12 })
  })

  it('keys the budget by domain only, with no second name for a contract limit', () => {
    // The move also deleted two aliases that restated a contract limit under a running name:
    // `defaultMaxFacts` repeated `maximumCollectionItems`, `maximumOutputBytes` repeated
    // `maximumModelOutputBytes`. A context now reads the contract constant directly, so a future
    // tune of either limit cannot leave a stale copy behind. This locks the shape of the object.
    expect(Object.keys(MARKET_ANALYSIS_CONTEXT_FACT_BUDGET).sort()).toEqual([
      'maximumMacroFacts',
      'minimumFactsPerDomain'
    ])
  })
})
