import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import { parseProcessingLabels } from '../intelligenceItemLabels'
import { resolveRegulatorDirection } from './impactClassifierHint'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateRegulatorRules(input: ImpactRuleInput): ImpactRuleResult[] {
  const sourceId = input.sourceDefinition.sourceId
  if (sourceId !== 'sec-rss' && sourceId !== 'cftc-rss') return []

  const labels = parseProcessingLabels(input.item.processingLabelsJson)
  if (labels.relevanceOutcome === 'ignore') return []

  const layer = input.sourceDefinition.intelligenceLayer ?? 'industry'
  const symbols = parseSymbols(input.item.symbolsJson)
  const direction = resolveRegulatorDirection({
    processingLabelsJson: input.item.processingLabelsJson,
    title: input.item.title,
    summary: input.item.summary
  })

  if (!direction) return []

  if (direction === 'bullish') {
    return regulationImpacts(input, layer, 'bullish', 'macro.regulation.positive.v1', symbols, 'Favorable regulatory development supports market access.')
  }
  return regulationImpacts(input, layer, 'bearish', 'macro.regulation.negative.v1', symbols, 'Restrictive regulatory action increases market uncertainty.')
}

function regulationImpacts(
  input: ImpactRuleInput,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  symbols: string[],
  reasoning: string
): ImpactRuleResult[] {
  const evidenceJson = JSON.stringify([{ label: 'headline', value: input.item.title }])
  const results: ImpactRuleResult[] = [
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 4,
      confidence: 75,
      horizon: '1w',
      reasoning,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    }
  ]

  for (const symbol of symbols.slice(0, 3)) {
    results.push({
      layer,
      scopeType: 'symbol',
      scopeKey: symbol,
      direction,
      magnitude: 4,
      confidence: 70,
      horizon: '1w',
      reasoning: `${reasoning} Directly affects ${symbol}.`,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    })
  }

  return results
}

function parseSymbols(symbolsJson?: string): string[] {
  if (!symbolsJson) return []
  try {
    const parsed = JSON.parse(symbolsJson) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
