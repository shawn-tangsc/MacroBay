import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'

const PRODUCT_ID = 'market-intelligence'

/**
 * The two macro snapshot tools the analysis agent may call on its own.
 *
 * Both read the very same snapshot the dashboard's 市场状态 block renders, through the public query
 * service, so the panel and the model can never disagree about a level. Each answers with the
 * snapshot as it is — `unavailable` when the query is not wired, `empty` when the store holds
 * nothing — and never with a filled-in default: an unwired source is a gap, not a zero.
 *
 * Neither is allowed to start an analysis (`autoTriggerAllowed` stays false on both sources in the
 * admission matrix); they only answer a question the model already decided to ask.
 */
export function registerMacroSnapshotProductTools(
  register: (registration: ProductAgentToolHandlerRegistration) => void,
  getPublicQueryService: () => MarketIntelligencePublicQueryService
): void {
  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-macro-market-snapshot',
    handle: async () => getPublicQueryService().queryMacroMarketSnapshot() ?? { state: 'unavailable' }
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-macro-rates-snapshot',
    handle: async () => getPublicQueryService().queryMacroRatesSnapshot() ?? { state: 'unavailable' }
  })
}
