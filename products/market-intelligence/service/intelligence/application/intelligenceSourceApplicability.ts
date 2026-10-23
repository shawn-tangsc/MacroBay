import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type {
  IntelligenceFocusMarket,
  IntelligenceSourceDefinition
} from '../schema/intelligenceSource'
import { attachSourceApplicability } from './sourceCatalogApplicability'
import { listIntelligenceSourceDefinitions } from './sourceCatalog'

export function withSourceApplicability(
  definition: IntelligenceSourceDefinition
): IntelligenceSourceDefinition {
  return attachSourceApplicability(definition)
}

export function listApplicableSourceDefinitions(
  enabledFocusMarkets: IntelligenceFocusMarket[]
): IntelligenceSourceDefinition[] {
  return listIntelligenceSourceDefinitions()
    .filter((definition) => definition.visibility !== 'hidden')
    .map(withSourceApplicability)
    .filter((definition) => isSourceApplicableToFocusMarkets(definition, enabledFocusMarkets))
}

export function isSourceApplicableToFocusMarkets(
  definition: IntelligenceSourceDefinition,
  enabledFocusMarkets: IntelligenceFocusMarket[]
): boolean {
  const applicability = withSourceApplicability(definition)
  const enabled = new Set(enabledFocusMarkets)

  if (applicability.applicabilityMode === 'global') {
    return enabled.has('global-macro')
  }

  return applicability.focusMarkets.some((market) => enabled.has(market))
}

export function resolveItemFocusMarkets(
  item: Pick<IntelligenceItem, 'title' | 'summary' | 'symbolsJson' | 'sourceCategory'>,
  definition: IntelligenceSourceDefinition
): IntelligenceFocusMarket[] {
  const applicability = withSourceApplicability(definition)

  if (applicability.applicabilityMode !== 'dynamic-detected') {
    return applicability.focusMarkets
  }

  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase()
  const markets = new Set<IntelligenceFocusMarket>()

  if (/crypto|bitcoin|ethereum|token|exchange|defi|blockchain|digital asset/i.test(text)) {
    if (applicability.focusMarkets.includes('digital-assets')) {
      markets.add('digital-assets')
    }
  }

  if (/equity|stock|share|nasdaq|nyse|etf|issuer|securities/i.test(text)) {
    if (applicability.focusMarkets.includes('us-equities')) {
      markets.add('us-equities')
    }
  }

  if (/futures|derivative|commodity|oil|gold|silver|wheat|corn/i.test(text)) {
    if (applicability.focusMarkets.includes('china-futures')) {
      markets.add('china-futures')
    }
    if (applicability.focusMarkets.includes('commodities')) {
      markets.add('commodities')
    }
  }

  return [...markets]
}

export function isItemApplicableToFocusMarkets(
  item: IntelligenceItem,
  definition: IntelligenceSourceDefinition,
  enabledFocusMarkets: IntelligenceFocusMarket[]
): boolean {
  if (!isSourceApplicableToFocusMarkets(definition, enabledFocusMarkets)) {
    return false
  }

  const applicability = withSourceApplicability(definition)
  if (applicability.applicabilityMode !== 'dynamic-detected') {
    return true
  }

  const itemMarkets = resolveItemFocusMarkets(item, definition)
  const enabled = new Set(enabledFocusMarkets)
  return itemMarkets.some((market) => enabled.has(market))
}

export function groupSourcesByFocusMarket(
  definitions: IntelligenceSourceDefinition[],
  enabledFocusMarkets: IntelligenceFocusMarket[]
): Record<'globalMacro' | 'digitalAssets' | 'multiMarketDynamic' | 'plannedMarkets', IntelligenceSourceDefinition[]> {
  const enabled = new Set(enabledFocusMarkets)
  const groups = {
    globalMacro: [] as IntelligenceSourceDefinition[],
    digitalAssets: [] as IntelligenceSourceDefinition[],
    multiMarketDynamic: [] as IntelligenceSourceDefinition[],
    plannedMarkets: [] as IntelligenceSourceDefinition[]
  }

  for (const raw of definitions) {
    const definition = withSourceApplicability(raw)
    if ((definition.readiness ?? 'live') === 'planned') {
      groups.plannedMarkets.push(definition)
      continue
    }

    if (definition.applicabilityMode === 'global') {
      groups.globalMacro.push(definition)
      continue
    }

    if (definition.applicabilityMode === 'dynamic-detected') {
      groups.multiMarketDynamic.push(definition)
      continue
    }

    if (definition.focusMarkets.some((market) => market === 'digital-assets' && enabled.has(market))) {
      groups.digitalAssets.push(definition)
      continue
    }

    if (definition.focusMarkets.some((market) => enabled.has(market))) {
      groups.globalMacro.push(definition)
    }
  }

  return groups
}
