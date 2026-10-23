import { parseProcessingLabels } from '../intelligenceItemLabels'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateStatusIncidentRules(input: ImpactRuleInput): ImpactRuleResult[] {
  const sourceId = input.sourceDefinition.sourceId
  if (
    sourceId !== 'coinbase-status' &&
    sourceId !== 'kraken-status' &&
    sourceId !== 'kraken-system-status' &&
    sourceId !== 'solana-status'
  ) {
    return []
  }

  const labels = parseProcessingLabels(input.item.processingLabelsJson)
  if (labels.relevanceOutcome === 'ignore') return []

  if (labels.eventSubtype === 'status-incident-resolved' || labels.relevanceOutcome === 'context-only') {
    return [
      {
        layer: sourceId === 'solana-status' ? 'infrastructure' : 'exchange',
        scopeType: sourceId === 'solana-status' ? 'crypto-market' : 'exchange',
        scopeKey: resolveScopeKey(sourceId),
        direction: 'neutral',
        magnitude: 1,
        confidence: 55,
        horizon: 'intraday',
        reasoning: 'Resolved or minor status update is informational context only.',
        evidenceJson: JSON.stringify([{ label: 'incident', value: input.item.title }]),
        ruleId: 'micro.status.resolved-context.v1',
        ruleVersion: 'v1'
      }
    ]
  }

  if (input.sourceDefinition.category === 'exchange-status' || input.item.eventType.includes('status') || input.item.eventType.includes('incident')) {
    return [
      {
        layer: sourceId === 'solana-status' ? 'infrastructure' : 'exchange',
        scopeType: sourceId === 'solana-status' ? 'crypto-market' : 'exchange',
        scopeKey: resolveScopeKey(sourceId),
        direction: 'bearish',
        magnitude: 4,
        confidence: 80,
        horizon: 'intraday',
        reasoning: 'Operational incident increases execution and custody risk.',
        evidenceJson: JSON.stringify([{ label: 'incident', value: input.item.title }]),
        ruleId: 'micro.exchange.incident.v1',
        ruleVersion: 'v1'
      }
    ]
  }

  return []
}

function resolveScopeKey(sourceId: string): string {
  if (sourceId.includes('coinbase')) return 'coinbase'
  if (sourceId.includes('kraken')) return 'kraken'
  if (sourceId === 'solana-status') return 'solana'
  return sourceId
}
