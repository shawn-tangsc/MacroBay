import type {
  IntelligenceImpactDirection,
  IntelligenceImpactHorizon,
  IntelligenceImpactScopeType,
  IntelligenceLayer
} from './intelligenceLayer'

export type IntelligenceImpactEvidence = {
  label: string
  value: string | number
  expected?: string | number
  previous?: string | number
  unit?: string
}

export type IntelligenceImpact = {
  impactId: string
  itemId: string
  clusterId?: string
  metricEventId?: string
  layer: IntelligenceLayer
  scopeType: IntelligenceImpactScopeType
  scopeKey: string
  direction: IntelligenceImpactDirection
  magnitude: 1 | 2 | 3 | 4 | 5
  confidence: number
  horizon: IntelligenceImpactHorizon
  reasoning: string
  evidenceJson: string
  ruleId: string
  ruleVersion: string
  createdAt: string
}

export type IntelligenceImpactDraft = Omit<
  IntelligenceImpact,
  'impactId' | 'itemId' | 'clusterId' | 'metricEventId' | 'createdAt'
>

export function parseImpactEvidence(value?: string): IntelligenceImpactEvidence[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as IntelligenceImpactEvidence[]) : []
  } catch {
    return []
  }
}
