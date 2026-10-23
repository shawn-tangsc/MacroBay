import type { IntelligenceAssessment } from '../schema/intelligenceAssessment'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceImpactDirection } from '../schema/intelligenceLayer'
import type { IntelligenceSentimentLabel } from '../schema/intelligenceSentiment'

export function buildAssessmentFromImpacts(input: {
  itemId: string
  clusterId?: string
  effectiveRevisionId?: string
  impacts: IntelligenceImpact[]
  assessmentCount: number
}): IntelligenceAssessment {
  const strongest = pickStrongestImpacts(input.impacts)
  const direction = resolveAssessmentDirection(strongest)
  const sentimentLabel = directionToSentimentLabel(direction)
  const strength = Math.max(...strongest.map((impact) => impact.magnitude), 3)
  const confidence = weightedConfidence(strongest)
  const horizon = mapImpactHorizon(strongest[0]?.horizon)

  return {
    assessmentId: `assessment-${input.itemId}-${input.assessmentCount + 1}`,
    itemId: input.itemId,
    clusterId: input.clusterId,
    assessmentType: 'rule',
    direction,
    strength,
    confidence,
    horizon,
    sentimentLabel,
    reasoningJson: JSON.stringify({
      ruleIds: [...new Set(strongest.map((impact) => impact.ruleId))],
      impactIds: strongest.map((impact) => impact.impactId),
      reasons: strongest.map((impact) => impact.reasoning)
    }),
    alertDecision: direction === 'neutral' || direction === 'mixed' ? 'timeline-only' : 'timeline-only',
    effectiveRevisionId: input.effectiveRevisionId,
    engineVersion: 'macro-sector-asset-v1',
    createdAt: new Date().toISOString()
  }
}

export function buildNeutralAssessment(input: {
  itemId: string
  clusterId?: string
  effectiveRevisionId?: string
  assessmentCount: number
  reason?: string
}): IntelligenceAssessment {
  return {
    assessmentId: `assessment-${input.itemId}-${input.assessmentCount + 1}`,
    itemId: input.itemId,
    clusterId: input.clusterId,
    assessmentType: 'rule',
    direction: 'neutral',
    strength: 1,
    confidence: 50,
    horizon: 'intraday',
    sentimentLabel: 'neutral',
    reasoningJson: JSON.stringify({
      reason: input.reason ?? 'no-impact-rule-matched'
    }),
    alertDecision: 'timeline-only',
    effectiveRevisionId: input.effectiveRevisionId,
    engineVersion: 'macro-sector-asset-v1',
    createdAt: new Date().toISOString()
  }
}

function pickStrongestImpacts(impacts: IntelligenceImpact[]): IntelligenceImpact[] {
  const directional = impacts.filter((impact) => impact.direction !== 'neutral')
  if (directional.length === 0) return impacts.slice(0, 1)

  const sorted = [...directional].sort((left, right) => {
    const leftScore = left.magnitude * left.confidence
    const rightScore = right.magnitude * right.confidence
    return rightScore - leftScore
  })

  const top = sorted[0]
  if (!top) return []
  const conflicting = sorted.filter((impact) => impact.direction !== top.direction && impact.magnitude >= 3)
  return conflicting.length > 0 ? [top, ...conflicting.slice(0, 1)] : [top]
}

function resolveAssessmentDirection(impacts: IntelligenceImpact[]): IntelligenceImpactDirection {
  if (impacts.length === 0) return 'neutral'
  const directions = new Set(impacts.map((impact) => impact.direction))
  if (directions.size > 1) return 'mixed'
  return impacts[0]?.direction ?? 'neutral'
}

function directionToSentimentLabel(direction: IntelligenceImpactDirection): IntelligenceSentimentLabel {
  switch (direction) {
    case 'bullish':
      return 'positive'
    case 'bearish':
      return 'negative'
    case 'mixed':
      return 'mixed'
    default:
      return 'neutral'
  }
}

function weightedConfidence(impacts: IntelligenceImpact[]): number {
  if (impacts.length === 0) return 50
  const totalWeight = impacts.reduce((sum, impact) => sum + impact.magnitude, 0)
  const weighted = impacts.reduce((sum, impact) => sum + impact.confidence * impact.magnitude, 0)
  return Math.round(weighted / Math.max(totalWeight, 1))
}

function mapImpactHorizon(horizon?: IntelligenceImpact['horizon']): IntelligenceAssessment['horizon'] {
  switch (horizon) {
    case 'intraday':
      return 'intraday'
    case '1d':
      return 'intraday'
    case '1w':
      return 'swing'
    case '1m':
      return 'long-term'
    default:
      return 'intraday'
  }
}
