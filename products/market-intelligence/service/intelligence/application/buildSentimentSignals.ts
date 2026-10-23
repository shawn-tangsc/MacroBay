import type { IntelligenceAssessment } from '../schema/intelligenceAssessment'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { SentimentSignalInput } from '../schema/intelligenceSentiment'

export function buildSentimentSignalFromImpact(
  impact: IntelligenceImpact,
  item: IntelligenceItem,
  assessment: IntelligenceAssessment,
  horizon: SentimentSignalInput['horizon']
): SentimentSignalInput {
  return {
    signalId: `signal-${impact.impactId}:${impact.scopeType}:${impact.scopeKey}:${horizon}`,
    itemId: item.itemId,
    clusterId: item.clusterId,
    assessmentId: assessment.assessmentId,
    impactId: impact.impactId,
    scopeType: impact.scopeType,
    scopeKey: impact.scopeKey,
    horizon,
    sourceGroup: item.sourceCategory,
    sentimentLabel: directionToSentimentLabel(impact.direction),
    strength: impact.magnitude,
    confidence: impact.confidence,
    trustLevel: item.sourceTrust as 'high' | 'medium' | 'low',
    layer: impact.layer,
    direction: impact.direction,
    magnitude: impact.magnitude,
    reasoning: impact.reasoning,
    evidenceJson: impact.evidenceJson,
    createdAt: assessment.createdAt
  }
}

export function buildSentimentSignalFromAssessment(
  assessment: IntelligenceAssessment,
  item: IntelligenceItem,
  scopeType: SentimentSignalInput['scopeType'],
  scopeKey: string,
  horizon: SentimentSignalInput['horizon']
): SentimentSignalInput {
  return {
    signalId: `signal-${assessment.assessmentId}:${scopeType}:${scopeKey}:${horizon}`,
    itemId: item.itemId,
    clusterId: item.clusterId,
    assessmentId: assessment.assessmentId,
    scopeType,
    scopeKey,
    horizon,
    sourceGroup: item.sourceCategory,
    sentimentLabel: assessment.sentimentLabel ?? 'neutral',
    strength: assessment.strength,
    confidence: assessment.confidence,
    trustLevel: item.sourceTrust as 'high' | 'medium' | 'low',
    createdAt: assessment.createdAt
  }
}

export function mapImpactHorizonToSentimentHorizon(
  horizon: IntelligenceImpact['horizon']
): SentimentSignalInput['horizon'] {
  switch (horizon) {
    case 'intraday':
      return '15m'
    case '1d':
      return '1h'
    case '1w':
      return '4h'
    case '1m':
      return '24h'
    default:
      return '1h'
  }
}

function directionToSentimentLabel(direction: IntelligenceImpact['direction']): SentimentSignalInput['sentimentLabel'] {
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

export const DEFAULT_AGGREGATE_SCOPES: Array<{
  scopeType: SentimentSignalInput['scopeType']
  scopeKey: string
}> = [
  { scopeType: 'market-wide', scopeKey: 'global' },
  { scopeType: 'crypto-market', scopeKey: 'global' },
  { scopeType: 'risk-assets', scopeKey: 'global' }
]
