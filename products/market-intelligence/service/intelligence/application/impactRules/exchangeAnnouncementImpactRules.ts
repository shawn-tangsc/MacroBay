import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import { parseProcessingLabels } from '../intelligenceItemLabels'
import { resolveExchangeAnnouncementAction } from './impactClassifierHint'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateExchangeAnnouncementRules(input: ImpactRuleInput): ImpactRuleResult[] {
  const sourceId = input.sourceDefinition.sourceId
  if (
    sourceId !== 'binance-announcements' &&
    sourceId !== 'binance-api-updates' &&
    !sourceId.startsWith('okx-')
  ) {
    return []
  }

  const labels = parseProcessingLabels(input.item.processingLabelsJson)
  if (labels.relevanceOutcome === 'ignore') return []

  const layer = input.sourceDefinition.intelligenceLayer ?? 'asset'
  const symbols = parseSymbols(input.item.symbolsJson)
  const symbol = symbols[0] ?? extractSymbolFromTitle(input.item.title)
  const action = resolveExchangeAnnouncementAction({
    processingLabelsJson: input.item.processingLabelsJson,
    title: input.item.title,
    summary: input.item.summary
  })

  if (action === 'api-context') {
    return [
      {
        layer: 'exchange',
        scopeType: 'exchange',
        scopeKey: 'binance',
        direction: 'neutral',
        magnitude: 1,
        confidence: 45,
        horizon: '1d',
        reasoning: 'API update is context-only and does not imply directional sentiment.',
        evidenceJson: JSON.stringify([{ label: 'headline', value: input.item.title }]),
        ruleId: 'micro.exchange.api-context.v1',
        ruleVersion: 'v1'
      }
    ]
  }

  if (action === 'delisting') {
    if (!symbol) return []
    return [textSymbolImpact(input, layer, symbol, 'bearish', 'micro.binance.delisting.v1', 'Delisting or collateral removal reduces access and liquidity for the symbol.')]
  }

  if (action === 'listing') {
    if (!symbol) return []
    return [textSymbolImpact(input, layer, symbol, 'bullish', 'micro.binance.listing.v1', 'Listing or derivatives launch improves access and liquidity for the symbol.')]
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
