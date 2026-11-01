import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_RUN_SOURCE_BUDGET } from './analysisRunPolicy'

describe('analysisRunPolicy', () => {
  it('holds the per-source read budgets it was moved out of the contract with, value for value', () => {
    expect(MARKET_ANALYSIS_RUN_SOURCE_BUDGET.macroCalendarMaximumEvents).toBe(200)
    expect(MARKET_ANALYSIS_RUN_SOURCE_BUDGET.policyPath.maximumFacts).toBe(8)
    expect(MARKET_ANALYSIS_RUN_SOURCE_BUDGET.policyPath.maximumPromptCharacters).toBe(900)
  })

  it('leaves the metric names in the contract, so a budget cannot rename a stored metric', () => {
    // This object is deliberately numbers only. The metric and caveat names it applies to are
    // identity: a stored fact carries one, and a reader switches on it. They stay closed sets in
    // `contracts/marketAnalysisContracts.ts`; moving them here would put the vocabulary a database
    // row names under a directory that is expected to be tuned.
    expect(Object.keys(MARKET_ANALYSIS_RUN_SOURCE_BUDGET).sort()).toEqual([
      'macroCalendarMaximumEvents',
      'policyPath'
    ])
    expect(Object.keys(MARKET_ANALYSIS_RUN_SOURCE_BUDGET.policyPath).sort()).toEqual([
      'maximumFacts',
      'maximumPromptCharacters'
    ])
  })
})
