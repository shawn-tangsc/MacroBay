import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateMicroRules(input: ImpactRuleInput): ImpactRuleResult[] {
  if (input.metricEvent) {
    return []
  }
  return evaluateMicroTextRules(input)
}

function evaluateMicroTextRules(input: ImpactRuleInput): ImpactRuleResult[] {
  const text = `${input.item.title} ${input.item.summary ?? ''}`.toLowerCase()
  const layer = input.sourceDefinition.intelligenceLayer ?? 'asset'
  const symbol = parseSymbols(input.item.symbolsJson)[0] ?? extractSymbolFromTitle(input.item.title)

  if (/exploit|hack|chain halt|failed upgrade|bridge.*loss/i.test(text)) {
    if (!symbol) return []
    return [textSymbolImpact(input, layer, symbol, 'bearish', 'micro.project.incident.v1', 'Project or chain incident raises immediate downside risk.')]
  }

  return []
}

function textSymbolImpact(
  input: ImpactRuleInput,
  layer: IntelligenceImpactDraft['layer'],
  symbol: string,
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  reasoning: string
): ImpactRuleResult {
  return {
    layer,
    scopeType: 'symbol',
    scopeKey: symbol,
    direction,
    magnitude: 4,
    confidence: 75,
    horizon: '1d',
    reasoning,
    evidenceJson: JSON.stringify([{ label: 'headline', value: input.item.title }]),
    ruleId,
    ruleVersion: 'v1'
  }
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

function extractSymbolFromTitle(title: string): string | undefined {
  const match = title.match(/\(([A-Z0-9]{2,10})\)/)
  return match?.[1]
}
