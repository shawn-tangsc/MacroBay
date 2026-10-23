import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import { parseProcessingLabels } from '../intelligenceItemLabels'
import { isClassifierSentimentEligible, resolveFedPolicyTone } from './impactClassifierHint'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateCentralBankRules(input: ImpactRuleInput): ImpactRuleResult[] {
  if (input.sourceDefinition.sourceId !== 'federal-reserve-rss') return []

  const labels = parseProcessingLabels(input.item.processingLabelsJson)
  if (labels.relevanceOutcome === 'context-only' && labels.sentimentEligible === false) {
    return []
  }

  if (!isClassifierSentimentEligible(input.item.processingLabelsJson)) {
    return []
  }

  const layer = input.sourceDefinition.intelligenceLayer ?? 'macro'
  const tone = resolveFedPolicyTone({
    processingLabelsJson: input.item.processingLabelsJson,
    title: input.item.title,
    summary: input.item.summary
  })

  if (tone === 'hawkish') {
    return [
      macroTextImpact(input, layer, 'bearish', 'macro.fed.hawkish.v1', 'risk-assets', 'Hawkish Fed messaging tightens risk-asset conditions.'),
      macroTextImpact(input, layer, 'bearish', 'macro.fed.hawkish.v1', 'crypto-market', 'Hawkish Fed messaging weighs on crypto-market liquidity.')
    ]
  }
  if (tone === 'dovish') {
    return [
      macroTextImpact(input, layer, 'bullish', 'macro.fed.dovish.v1', 'risk-assets', 'Dovish Fed messaging supports risk appetite.'),
      macroTextImpact(input, layer, 'bullish', 'macro.fed.dovish.v1', 'crypto-market', 'Dovish Fed messaging supports crypto-market sentiment.')
    ]
  }

  return []
}

function macroTextImpact(
  input: ImpactRuleInput,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  scopeType: IntelligenceImpactDraft['scopeType'],
  reasoning: string
): ImpactRuleResult {
  return {
    layer,
    scopeType,
    scopeKey: 'global',
    direction,
    magnitude: direction === 'mixed' ? 2 : 3,
    confidence: 70,
    horizon: '1w',
    reasoning,
    evidenceJson: JSON.stringify([{ label: 'headline', value: input.item.title }]),
    ruleId,
    ruleVersion: 'v1'
  }
}
