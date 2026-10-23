import { evaluateCentralBankRules } from './centralBankImpactRules'
import { evaluateExchangeAnnouncementRules } from './exchangeAnnouncementImpactRules'
import { evaluateIndustryRules } from './industryImpactRules'
import { evaluateMacroRules } from './macroImpactRules'
import { evaluateMarketStructureRules } from './marketStructureImpactRules'
import { evaluateMicroRules } from './microImpactRules'
import { evaluateRegulatorRules } from './regulatorImpactRules'
import { evaluateStatusIncidentRules } from './statusIncidentImpactRules'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateImpact(input: ImpactRuleInput): ImpactRuleResult[] {
  const sourceId = input.sourceDefinition.sourceId
  const layer = input.sourceDefinition.intelligenceLayer ?? 'industry'

  if (input.metricEvent) {
    if (layer === 'macro') return evaluateMacroRules(input)
    if (isMarketStructureSource(sourceId)) return evaluateMarketStructureRules(input)
    if (layer === 'industry' || layer === 'infrastructure') {
      return [...evaluateMarketStructureRules(input), ...evaluateIndustryRules(input)]
    }
    return [...evaluateMarketStructureRules(input), ...evaluateMicroRules(input)]
  }

  const domainResults = [
    ...evaluateCentralBankRules(input),
    ...evaluateRegulatorRules(input),
    ...evaluateExchangeAnnouncementRules(input),
    ...evaluateStatusIncidentRules(input)
  ]
  if (domainResults.length > 0) return domainResults

  switch (layer) {
    case 'macro':
      return evaluateMacroRules(input)
    case 'industry':
    case 'infrastructure':
      return [...evaluateIndustryRules(input), ...evaluateMacroRules(input)]
    case 'asset':
    case 'exchange':
    case 'project':
      return evaluateMicroRules(input)
    default:
      return evaluateMicroRules(input)
  }
}

function isMarketStructureSource(sourceId: string): boolean {
  return (
    sourceId === 'alternative-fear-greed' ||
    sourceId === 'defillama-tvl' ||
    sourceId === 'binance-spot-market' ||
    sourceId === 'binance-futures-positioning'
  )
}

export type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'
