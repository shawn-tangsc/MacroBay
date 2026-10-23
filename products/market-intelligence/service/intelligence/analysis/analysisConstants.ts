import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'

export const marketAnalysisValidationPolicy = Object.freeze({
  owner: 'market-intelligence.analysis-output-validator',
  schemaVersion: MARKET_ANALYSIS_CONTRACT_POLICY.schemaVersion,
  maximumFieldCharacters: MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelFieldCharacters,
  maximumOutputBytes: MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelOutputBytes,
  maximumCollectionItems: MARKET_ANALYSIS_CONTRACT_POLICY.maximumCollectionItems,
  scenarioHorizons: ['0-15m', '15m-2h', '2h-24h', '1d-3d'] as const,
  /**
   * Operation directions: one entry per horizon, each with a direction term, a one-line rationale,
   * a confidence and the evidence it rests on.
   */
  directionHorizons: ['short', 'medium', 'long'] as const,
  /** What each horizon means, as the prompt states it and the reader reads it. */
  directionWindows: Object.freeze({ short: '0-24 小时', medium: '1-7 天', long: '1-4 周' }),
  /**
   * The five direction terms, mirrored from the renderer's `analysisConclusionDirectionPolicy`.
   * The service keeps its own copy because the renderer's policy lives in the desktop layer; a
   * parity test keeps the two lists identical.
   */
  directionTerms: ['偏多', '偏空', '震荡', '暂不判断', '信号冲突'] as const,
  /**
   * 语言无关的方向 key。模型输出、结构化结论和存储都用它；中文术语只用于读旧结论。
   */
  analysisDirectionKeys: ['bullish', 'bearish', 'range', 'undecided', 'mixed'] as const,
  directionConfidences: ['low', 'medium', 'high'] as const,
  modelPredictionStatus: 'pending' as const
})

// Historical message evidence can support an assessment, not a current market reaction.
export const marketReactionEvidencePolicy = Object.freeze({
  excludedMetric: 'event-excerpt',
  requiredComparability: 'comparable' as const,
  requiredFreshness: 'fresh' as const
})

/**
 * The facts a market reaction may cite.
 *
 * One predicate, read by both the validator and the prompt: the validator rejects a reaction that
 * cites anything else, and the prompt hands the model the resulting id list explicitly instead of
 * leaving it to infer eligibility from a readable `comparability` label.
 */
export function isMarketReactionFact(fact: Readonly<{ metric: string; comparability: string; freshness: string }>): boolean {
  return fact.metric !== marketReactionEvidencePolicy.excludedMetric &&
    fact.comparability === marketReactionEvidencePolicy.requiredComparability &&
    fact.freshness === marketReactionEvidencePolicy.requiredFreshness
}

export const marketAnalysisUnsafeOutputPolicy = Object.freeze({
  owner: 'market-intelligence.analysis-output-validator',
  /** Replaces a matched pattern in place, so a usable conclusion survives. */
  redactionToken: '[已移除]',
  prohibitedPatterns: [
    /(?:https?:\/\/|www\.)/iu,
    /(?:^|\s)(?:\/?[\w.-]+\/){2,}[\w.-]+/u,
    /\b(?:api[_\-\s]*key|authorization|bearer|token|secret|password|provider[_\-\s]*(?:body|error))\b/iu
  ] as const
})
