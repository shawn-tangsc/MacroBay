import type {
  IntelligenceSentimentAggregate,
  IntelligenceSentimentHorizon,
  IntelligenceSentimentLabel,
  SentimentSignalInput
} from '../schema/intelligenceSentiment'
import {
  HORIZON_MS,
  LABEL_BASE_SCORE,
  LAYER_WEIGHTS,
  SCOPE_WEIGHTS,
  TRUST_WEIGHTS
} from '../schema/intelligenceSentiment'

export function scoreSentimentSignal(input: SentimentSignalInput, nowMs = Date.now()): number {
  const ageMs = nowMs - new Date(input.createdAt).getTime()
  if (ageMs > HORIZON_MS[input.horizon]) return 0

  const recencyDecay = Math.max(0, 1 - ageMs / HORIZON_MS[input.horizon])
  const layerWeight = input.layer ? LAYER_WEIGHTS[input.layer] : 1
  const magnitudeNormalized = (input.magnitude ?? input.strength ?? 3) / 5
  const confidenceNormalized = (input.confidence ?? 70) / 100

  return (
    LABEL_BASE_SCORE[input.sentimentLabel] *
    magnitudeNormalized *
    confidenceNormalized *
    TRUST_WEIGHTS[input.trustLevel] *
    SCOPE_WEIGHTS[input.scopeType] *
    layerWeight *
    recencyDecay
  )
}

export function aggregateSentimentSignals(
  input: {
    scopeType: SentimentSignalInput['scopeType']
    scopeKey: string
    horizon: IntelligenceSentimentHorizon
    signals: SentimentSignalInput[]
  },
  nowMs = Date.now()
): IntelligenceSentimentAggregate {
  const inHorizonSignals = input.signals.filter((signal) => {
    const ageMs = nowMs - new Date(signal.createdAt).getTime()
    return ageMs <= HORIZON_MS[input.horizon]
  })

  const scored = inHorizonSignals
    .map((signal) => ({
      signal,
      score: scoreSentimentSignal(signal, nowMs),
      weight:
        TRUST_WEIGHTS[signal.trustLevel] *
        SCOPE_WEIGHTS[signal.scopeType] *
        (signal.layer ? LAYER_WEIGHTS[signal.layer] : 1) *
        ((signal.confidence ?? 70) / 100)
    }))
    .filter((entry) => entry.score !== 0)

  const sourceGroupBreakdown = buildBreakdown(scored, (signal) => signal.sourceGroup)
  const layerBreakdown = buildBreakdown(scored, (signal) => signal.layer ?? 'industry')
  const directionBreakdown = buildDirectionBreakdown(scored)
  const supportingImpactIds = [...new Set(inHorizonSignals.map((signal) => signal.impactId).filter(Boolean))]

  const numerator = scored.reduce((sum, entry) => sum + entry.score, 0)
  const denominator = scored.reduce((sum, entry) => sum + Math.abs(entry.weight), 0)
  const aggregateScore = clamp(denominator === 0 ? 0 : numerator / denominator, -1, 1)

  const positiveContribution = scored
    .filter((entry) => entry.score > 0)
    .reduce((sum, entry) => sum + Math.abs(entry.score), 0)
  const negativeContribution = scored
    .filter((entry) => entry.score < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.score), 0)
  const totalContribution = positiveContribution + negativeContribution

  return {
    aggregateId: `${input.scopeType}:${input.scopeKey}:${input.horizon}`,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    horizon: input.horizon,
    aggregateScore,
    aggregateLabel: resolveAggregateLabel(aggregateScore, positiveContribution, negativeContribution, totalContribution),
    confidence: denominator === 0 ? 0 : Math.min(1, denominator / Math.max(1, input.signals.length)),
    signalCount: scored.length,
    supportingItemIdsJson: JSON.stringify([...new Set(inHorizonSignals.map((signal) => signal.itemId))]),
    supportingClusterIdsJson: JSON.stringify([
      ...new Set(inHorizonSignals.map((signal) => signal.clusterId).filter(Boolean))
    ]),
    sourceGroupBreakdownJson: JSON.stringify(sourceGroupBreakdown),
    layerBreakdownJson: JSON.stringify(layerBreakdown),
    directionBreakdownJson: JSON.stringify(directionBreakdown),
    supportingImpactIdsJson: JSON.stringify(supportingImpactIds),
    updatedAt: new Date(nowMs).toISOString(),
    aggregateVersion: 'macro-sector-asset-v1'
  }
}

function buildBreakdown(
  scored: Array<{ signal: SentimentSignalInput; score: number }>,
  pickKey: (signal: SentimentSignalInput) => string
): Record<string, number> {
  const breakdown: Record<string, number> = {}
  for (const entry of scored) {
    const key = pickKey(entry.signal)
    breakdown[key] = (breakdown[key] ?? 0) + entry.score
  }
  return breakdown
}

function buildDirectionBreakdown(
  scored: Array<{ signal: SentimentSignalInput; score: number }>
): Record<string, number> {
  const breakdown: Record<string, number> = {}
  for (const entry of scored) {
    const key = entry.signal.direction ?? entry.signal.sentimentLabel
    if (key === 'neutral' || key === 'mixed') continue
    breakdown[key] = (breakdown[key] ?? 0) + entry.score
  }
  return breakdown
}

function resolveAggregateLabel(
  aggregateScore: number,
  positiveContribution: number,
  negativeContribution: number,
  totalContribution: number
): IntelligenceSentimentLabel {
  if (aggregateScore >= 0.25) return 'positive'
  if (aggregateScore <= -0.25) return 'negative'

  if (totalContribution > 0) {
    const positiveRatio = positiveContribution / totalContribution
    const negativeRatio = negativeContribution / totalContribution
    if (positiveRatio >= 0.3 && negativeRatio >= 0.3) return 'mixed'
  }

  return 'neutral'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
