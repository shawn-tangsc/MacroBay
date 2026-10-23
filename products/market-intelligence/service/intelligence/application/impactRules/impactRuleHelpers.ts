import type { IntelligenceImpactEvidence } from '../../schema/intelligenceImpact'
import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'

export function buildEvidence(
  metric: MetricIntelligenceEvent | undefined,
  extra: IntelligenceImpactEvidence[] = []
): string {
  const rows: IntelligenceImpactEvidence[] = []
  if (metric) {
    rows.push({
      label: metric.metricName,
      value: metric.actual,
      expected: metric.forecast,
      previous: metric.previous,
      unit: metric.unit
    })
    if (metric.comparisonBasis === 'actual-vs-previous' && metric.forecast === undefined) {
      rows.push({ label: 'forecast', value: 'missing' })
    }
  }
  return JSON.stringify([...rows, ...extra])
}

export function cloneImpactDraft(
  draft: IntelligenceImpactDraft,
  patch: Partial<IntelligenceImpactDraft>
): IntelligenceImpactDraft {
  return { ...draft, ...patch }
}

export function inflationHotImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer']
): IntelligenceImpactDraft[] {
  const confidence = metric.metricKey.includes('CORE') ? 85 : 75
  const magnitude = metric.surpriseMagnitude && metric.surpriseMagnitude > 0.3 ? 4 : 3
  const evidenceJson = buildEvidence(metric)
  const base = {
    layer,
    direction: 'bearish' as const,
    magnitude: magnitude as 3 | 4,
    confidence,
    horizon: '1w' as const,
    evidenceJson,
    ruleVersion: 'v1'
  }

  return [
    {
      ...base,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      reasoning: 'Hot inflation increases rate-hike pressure on risk assets.',
      ruleId: 'macro.inflation.hot.v1'
    },
    {
      ...base,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      reasoning: 'Hot inflation is bearish for crypto liquidity and duration assets.',
      ruleId: 'macro.inflation.hot.v1'
    },
    {
      ...base,
      scopeType: 'symbol',
      scopeKey: 'BTC',
      magnitude: 3,
      confidence: confidence - 5,
      reasoning: 'BTC tends to reprice lower when inflation surprises hot.',
      ruleId: 'macro.inflation.hot.v1'
    },
    {
      ...base,
      scopeType: 'symbol',
      scopeKey: 'ETH',
      magnitude: 3,
      confidence: confidence - 5,
      reasoning: 'ETH beta to macro liquidity weakens on hot inflation prints.',
      ruleId: 'macro.inflation.hot.v1'
    }
  ]
}

export function inflationCoolingImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer']
): IntelligenceImpactDraft[] {
  const confidence = metric.metricKey.includes('CORE') ? 85 : 70
  const evidenceJson = buildEvidence(metric)
  const base = {
    layer,
    direction: 'bullish' as const,
    magnitude: 3 as const,
    confidence,
    horizon: '1w' as const,
    evidenceJson,
    ruleVersion: 'v1'
  }

  return [
    {
      ...base,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      reasoning: 'Cooling inflation reduces tightening pressure on risk assets.',
      ruleId: 'macro.inflation.cooling.v1'
    },
    {
      ...base,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      reasoning: 'Cooling inflation supports crypto liquidity conditions.',
      ruleId: 'macro.inflation.cooling.v1'
    },
    {
      ...base,
      scopeType: 'symbol',
      scopeKey: 'BTC',
      confidence: confidence - 5,
      reasoning: 'BTC often benefits when inflation cools without recession panic.',
      ruleId: 'macro.inflation.cooling.v1'
    },
    {
      ...base,
      scopeType: 'symbol',
      scopeKey: 'ETH',
      confidence: confidence - 5,
      reasoning: 'ETH risk appetite improves when inflation cools.',
      ruleId: 'macro.inflation.cooling.v1'
    }
  ]
}
