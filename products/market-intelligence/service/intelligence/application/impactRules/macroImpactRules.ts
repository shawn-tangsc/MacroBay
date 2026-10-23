import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'
import { buildEvidence, inflationCoolingImpact, inflationHotImpact } from './impactRuleHelpers'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

const INFLATION_KEYS = new Set(['US_CPI_HEADLINE_YOY', 'US_CPI_CORE_YOY', 'US_PCE_HEADLINE_YOY', 'US_PCE_CORE_YOY'])
const EMPLOYMENT_HOT_KEYS = new Set(['US_PAYROLLS_NFP', 'US_AVG_HOURLY_EARNINGS'])
const YIELD_KEYS = new Set(['US_2Y_YIELD', 'US_10Y_YIELD', 'US_REAL_YIELD_10Y'])
const GROWTH_KEYS = new Set(['US_GDP_REAL_QOQ_ANNUALIZED'])
const TREASURY_LIQUIDITY_KEYS = new Set(['US_TGA_BALANCE', 'US_TGA_DEPOSITS', 'US_TGA_WITHDRAWALS', 'US_FISCAL_LIQUIDITY_PROXY'])

export function evaluateMacroRules(input: ImpactRuleInput): ImpactRuleResult[] {
  if (input.metricEvent) {
    return evaluateMacroMetricRules(input, input.metricEvent)
  }
  return evaluateMacroTextRules(input)
}

function evaluateMacroMetricRules(input: ImpactRuleInput, metric: MetricIntelligenceEvent): ImpactRuleResult[] {
  const layer = input.sourceDefinition.intelligenceLayer ?? 'macro'

  if (INFLATION_KEYS.has(metric.metricKey)) {
    if (isHotInflation(metric)) return inflationHotImpact(metric, layer)
    if (isCoolingInflation(metric)) return inflationCoolingImpact(metric, layer)
    return []
  }

  if (EMPLOYMENT_HOT_KEYS.has(metric.metricKey)) {
    if (isHotEmployment(metric)) {
      return [
        employmentImpact(metric, layer, 'bearish', 'macro.employment.hot.v1', 70, 'Hot labor data keeps policy restrictive.'),
        employmentImpact(metric, layer, 'bearish', 'macro.employment.hot.v1', 65, 'Hot labor data is bearish for crypto liquidity.', 'crypto-market')
      ]
    }
    if (isRecessionRiskEmployment(metric)) {
      return [
        employmentImpact(metric, layer, 'mixed', 'macro.employment.recession-risk.v1', 70, 'Sharp labor deterioration raises recession risk.', 'risk-assets'),
        employmentImpact(metric, layer, 'bearish', 'macro.employment.recession-risk.v1', 65, 'Sharp labor miss can hit crypto beta.', 'crypto-market')
      ]
    }
    if (isCoolingEmployment(metric)) {
      return [
        employmentImpact(metric, layer, 'bullish', 'macro.employment.cooling.v1', 65, 'Moderate labor cooling supports easier policy expectations.'),
        employmentImpact(metric, layer, 'bullish', 'macro.employment.cooling.v1', 60, 'Moderate labor cooling supports crypto risk appetite.', 'crypto-market')
      ]
    }
  }

  if (metric.metricKey === 'US_UNEMPLOYMENT_RATE') {
    if (metric.surpriseDirection === 'above' && (metric.surpriseMagnitude ?? 0) >= 0.3) {
      return [
        employmentImpact(metric, layer, 'mixed', 'macro.employment.recession-risk.v1', 65, 'Unemployment jump raises recession risk.', 'risk-assets'),
        employmentImpact(metric, layer, 'bearish', 'macro.employment.recession-risk.v1', 60, 'Rising unemployment can weaken crypto demand.', 'crypto-market')
      ]
    }
    if (metric.surpriseDirection === 'above') {
      return [
        employmentImpact(metric, layer, 'bullish', 'macro.employment.cooling.v1', 55, 'Moderate unemployment rise can ease policy pressure.', 'risk-assets')
      ]
    }
  }

  if (YIELD_KEYS.has(metric.metricKey)) {
    if (metric.surpriseDirection === 'up' || (metric.previous !== undefined && metric.actual > metric.previous + 0.05)) {
      return yieldImpact(metric, layer, 'bearish', 'macro.yields.up.v1', 'Rising yields tighten financial conditions for risk assets.')
    }
    if (metric.surpriseDirection === 'down' || (metric.previous !== undefined && metric.actual < metric.previous - 0.05)) {
      return yieldImpact(metric, layer, 'bullish', 'macro.yields.down.v1', 'Falling yields support duration and risk assets.')
    }
  }

  if (metric.metricKey === 'DXY_PROXY') {
    if (metric.surpriseDirection === 'up') {
      return dollarImpact(metric, layer, 'bearish', 'macro.dollar.up.v1', 'A stronger dollar is bearish for crypto-market liquidity.')
    }
    if (metric.surpriseDirection === 'down') {
      return dollarImpact(metric, layer, 'bullish', 'macro.dollar.down.v1', 'A weaker dollar supports crypto-market liquidity.')
    }
  }

  if (metric.metricKey === 'FED_BALANCE_SHEET') {
    if (metric.surpriseDirection === 'up') {
      return liquidityImpact(metric, layer, 'bullish', 'Balance sheet expansion adds system liquidity.')
    }
    if (metric.surpriseDirection === 'down') {
      return liquidityImpact(metric, layer, 'bearish', 'Balance sheet contraction removes system liquidity.')
    }
  }

  if (GROWTH_KEYS.has(metric.metricKey)) {
    if (metric.surpriseDirection === 'below' || (metric.previous !== undefined && metric.actual < metric.previous - 0.3)) {
      return growthImpact(metric, layer, 'mixed', 'macro.growth.weak.v1', 'Weak growth raises recession-risk concerns.')
    }
    if (metric.surpriseDirection === 'above') {
      return growthImpact(metric, layer, 'bullish', 'macro.growth.strong.v1', 'Strong growth supports risk appetite when inflation pressure stays contained.')
    }
  }

  if (TREASURY_LIQUIDITY_KEYS.has(metric.metricKey)) {
    return treasuryLiquidityImpact(metric, layer)
  }

  return []
}

function evaluateMacroTextRules(_input: ImpactRuleInput): ImpactRuleResult[] {
  return []
}

function isHotInflation(metric: MetricIntelligenceEvent): boolean {
  if (metric.surpriseDirection === 'above') return true
  if (metric.forecast !== undefined) return metric.actual > metric.forecast
  return metric.previous !== undefined && metric.actual > metric.previous
}

function isCoolingInflation(metric: MetricIntelligenceEvent): boolean {
  if (metric.surpriseDirection === 'below') return true
  if (metric.forecast !== undefined) return metric.actual < metric.forecast
  return metric.previous !== undefined && metric.actual < metric.previous
}

function isHotEmployment(metric: MetricIntelligenceEvent): boolean {
  if (metric.surpriseDirection === 'below') return false
  if (metric.surpriseDirection === 'above') return true
  return metric.previous !== undefined && metric.actual > metric.previous
}

function isRecessionRiskEmployment(metric: MetricIntelligenceEvent): boolean {
  return metric.surpriseDirection === 'below' && (metric.surpriseMagnitude ?? 0) >= 100
}

function isCoolingEmployment(metric: MetricIntelligenceEvent): boolean {
  if (isRecessionRiskEmployment(metric)) return false
  return metric.surpriseDirection === 'below' || (metric.previous !== undefined && metric.actual < metric.previous)
}

function employmentImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  confidence: number,
  reasoning: string,
  scopeType: IntelligenceImpactDraft['scopeType'] = 'risk-assets'
): ImpactRuleResult {
  return {
    layer,
    scopeType,
    scopeKey: 'global',
    direction,
    magnitude: direction === 'mixed' ? 3 : 3,
    confidence,
    horizon: '1w',
    reasoning,
    evidenceJson: buildEvidence(metric),
    ruleId,
    ruleVersion: 'v1'
  }
}

function yieldImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  reasoning: string
): ImpactRuleResult[] {
  const evidenceJson = buildEvidence(metric)
  return [
    {
      layer,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 70,
      horizon: '1d',
      reasoning,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    },
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 65,
      horizon: '1d',
      reasoning,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    }
  ]
}

function dollarImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  reasoning: string
): ImpactRuleResult[] {
  return [
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 65,
      horizon: '1d',
      reasoning,
      evidenceJson: buildEvidence(metric),
      ruleId,
      ruleVersion: 'v1'
    }
  ]
}

function liquidityImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  reasoning: string
): ImpactRuleResult[] {
  return [
    {
      layer,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 60,
      horizon: '1w',
      reasoning,
      evidenceJson: buildEvidence(metric),
      ruleId: direction === 'bullish' ? 'macro.liquidity.expansion.v1' : 'macro.liquidity.contraction.v1',
      ruleVersion: 'v1'
    }
  ]
}

function growthImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  reasoning: string
): ImpactRuleResult[] {
  return [
    {
      layer,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 65,
      horizon: '1w',
      reasoning,
      evidenceJson: buildEvidence(metric),
      ruleId,
      ruleVersion: 'v1'
    },
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 3,
      confidence: 60,
      horizon: '1w',
      reasoning,
      evidenceJson: buildEvidence(metric),
      ruleId,
      ruleVersion: 'v1'
    }
  ]
}

function treasuryLiquidityImpact(metric: MetricIntelligenceEvent, layer: IntelligenceImpactDraft['layer']): ImpactRuleResult[] {
  const rising = metric.surpriseDirection === 'up' || (metric.previous !== undefined && metric.actual > metric.previous)
  const falling = metric.surpriseDirection === 'down' || (metric.previous !== undefined && metric.actual < metric.previous)
  const smallMove =
    metric.previous !== undefined && Math.abs(metric.actual - metric.previous) < Math.max(Math.abs(metric.previous) * 0.01, 1000)

  if (smallMove) return []

  const direction: IntelligenceImpactDraft['direction'] = rising
    ? metric.metricKey === 'US_TGA_BALANCE' || metric.metricKey === 'US_TGA_DEPOSITS'
      ? 'bearish'
      : 'bullish'
    : falling
      ? metric.metricKey === 'US_TGA_BALANCE' || metric.metricKey === 'US_TGA_DEPOSITS'
        ? 'bullish'
        : 'bearish'
      : 'neutral'

  if (direction === 'neutral') return []

  const evidenceJson = buildEvidence(metric, [{ label: 'caveat', value: 'fiscal-liquidity-proxy' }])
  const reasoning =
    direction === 'bearish'
      ? 'Rising Treasury General Account balance is a fiscal liquidity proxy that can drain market liquidity.'
      : 'Falling Treasury General Account balance is a fiscal liquidity proxy that can add market liquidity.'

  return [
    {
      layer,
      scopeType: 'risk-assets',
      scopeKey: 'global',
      direction,
      magnitude: 2,
      confidence: 50,
      horizon: '1w',
      reasoning,
      evidenceJson,
      ruleId: direction === 'bearish' ? 'macro.treasury.liquidity-drain.v1' : 'macro.treasury.liquidity-add.v1',
      ruleVersion: 'v1'
    },
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 2,
      confidence: 45,
      horizon: '1w',
      reasoning,
      evidenceJson,
      ruleId: direction === 'bearish' ? 'macro.treasury.liquidity-drain.v1' : 'macro.treasury.liquidity-add.v1',
      ruleVersion: 'v1'
    }
  ]
}

function macroTextImpact(
  input: ImpactRuleInput,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  scopeType: IntelligenceImpactDraft['scopeType'],
  reasoning: string
): ImpactRuleResult {
  return {
    layer,
    scopeType,
    scopeKey: 'global',
    direction,
    magnitude: direction === 'mixed' ? 2 : 3,
    confidence: 70,
    horizon: '1w',
    reasoning,
    evidenceJson: JSON.stringify([{ label: 'headline', value: input.item.title }]),
    ruleId,
    ruleVersion: 'v1'
  }
}

function regulationImpacts(
  input: ImpactRuleInput,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  symbols: string[],
  reasoning: string
): ImpactRuleResult[] {
  const evidenceJson = JSON.stringify([{ label: 'headline', value: input.item.title }])
  const results: ImpactRuleResult[] = [
    {
      layer,
      scopeType: 'crypto-market',
      scopeKey: 'global',
      direction,
      magnitude: 4,
      confidence: 75,
      horizon: '1w',
      reasoning,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    }
  ]

  for (const symbol of symbols.slice(0, 3)) {
    results.push({
      layer,
      scopeType: 'symbol',
      scopeKey: symbol,
      direction,
      magnitude: 4,
      confidence: 70,
      horizon: '1w',
      reasoning: `${reasoning} Directly affects ${symbol}.`,
      evidenceJson,
      ruleId,
      ruleVersion: 'v1'
    })
  }

  return results
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
