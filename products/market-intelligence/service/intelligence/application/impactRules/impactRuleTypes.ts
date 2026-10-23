import type { IntelligenceItem } from '../../schema/intelligenceRecord'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import type { IntelligenceSourceDefinition } from '../../schema/intelligenceSource'

export type ImpactRuleInput = {
  item: IntelligenceItem
  metricEvent?: MetricIntelligenceEvent
  sourceDefinition: IntelligenceSourceDefinition
  now?: string
}

export type ImpactRuleResult = IntelligenceImpactDraft

export { evaluateImpact } from './impactRuleEngine'
