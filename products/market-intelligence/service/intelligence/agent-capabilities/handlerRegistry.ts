import type { JobRuntime } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  ProductAgentToolHandler,
  ProductAgentToolHandlerRegistration
} from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { intelligenceAgentCapabilities, type CapabilityId } from './capabilityCatalog'
import type { GuardedHandler } from './capabilityTypes'
import { registerIntelligenceProductTools } from '../product-tools/registerIntelligenceProductTools'
import { isGuardedHandler, wrapProductToolHandler } from './wrapProductToolHandler'
import {
  handleDescribeIntelligenceCapabilities,
  handleGetCrossAssetSnapshot,
  handleGetDashboardFeedStatus,
  handleGetIntelligenceTimeline,
  handleGetOperationsHealth,
  handleGetSourceDetail,
  handleGetTranslationStatus,
  handleListIntelligenceSources,
  handleQueryMacroCalendar,
  type ReadHandlerDeps
} from './readHandlers'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceAgentToolHandlerDeps = {
  jobRuntime: JobRuntime
  getAppLanguage?: () => Promise<AppLanguage>
}

type HandlerFactoryDeps = {
  jobRuntime: JobRuntime
  getAppLanguage: () => Promise<AppLanguage>
  adapterHandlers: ReadonlyMap<string, ProductAgentToolHandlerRegistration>
}

type HandlerFactory = (deps: HandlerFactoryDeps) => ProductAgentToolHandler

/**
 * The closed mapping from capability id to product code (design 152 §2.1).
 *
 * `Record<CapabilityId, HandlerFactory>` is the compile-time half of the anti-drift mechanism: a
 * capability without a factory, or a factory without a capability, is a type error. The ten
 * pre-existing adapters are collected from `registerIntelligenceProductTools` rather than rewritten,
 * so their own tests keep covering them.
 */
const handlerFactories: Record<CapabilityId, HandlerFactory> = {
  get_market_analysis_context: adapter('market-intelligence.get-market-analysis-context'),
  get_macro_market_snapshot: adapter('market-intelligence.get-macro-market-snapshot'),
  get_macro_rates_snapshot: adapter('market-intelligence.get-macro-rates-snapshot'),
  explain_figure: adapter('market-intelligence.explain-figure'),
  query_sentiment_snapshot: adapter('market-intelligence.query-sentiment-snapshot'),
  query_sentiment_series: adapter('market-intelligence.query-sentiment-series'),
  query_related_events: adapter('market-intelligence.query-related-events'),
  query_impact_timeline: adapter('market-intelligence.query-impact-timeline'),
  get_evidence_excerpt: adapter('market-intelligence.get-evidence-excerpt'),
  get_source_health: adapter('market-intelligence.get-source-health'),
  get_operations_health: read(handleGetOperationsHealth),
  list_intelligence_sources: read(handleListIntelligenceSources),
  get_source_detail: read(handleGetSourceDetail),
  get_intelligence_timeline: read(handleGetIntelligenceTimeline),
  query_macro_calendar: read(handleQueryMacroCalendar),
  get_translation_status: read(handleGetTranslationStatus),
  get_cross_asset_snapshot: read(handleGetCrossAssetSnapshot),
  get_dashboard_feed_status: read(handleGetDashboardFeedStatus),
  describe_intelligence_capabilities: read(handleDescribeIntelligenceCapabilities)
}

export function registerIntelligenceAgentToolHandlers(
  register: (registration: ProductAgentToolHandlerRegistration) => void,
  deps: IntelligenceAgentToolHandlerDeps
): void {
  const getAppLanguage = deps.getAppLanguage ?? (async () => 'zh-CN' as const)
  const adapterHandlers = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceProductTools(
    (registration) => adapterHandlers.set(registration.handlerId, registration),
    deps.jobRuntime
  )

  const registeredHandlerIds = new Set<string>()
  for (const capability of intelligenceAgentCapabilities) {
    if (registeredHandlerIds.has(capability.handlerId)) {
      throw new Error(`Duplicate handlerId declared for capability "${capability.id}".`)
    }
    const factory = handlerFactories[capability.id]
    if (!factory) {
      throw new Error(`No handler factory for capability "${capability.id}".`)
    }
    const guarded: GuardedHandler = wrapProductToolHandler({
      capability,
      handle: factory({ jobRuntime: deps.jobRuntime, getAppLanguage, adapterHandlers })
    })
    if (!isGuardedHandler(guarded) || guarded.capabilityId !== capability.id) {
      throw new Error(`Capability "${capability.id}" produced an unguarded handler.`)
    }
    registeredHandlerIds.add(capability.handlerId)
    register({
      productId: PRODUCT_ID,
      handlerId: capability.handlerId,
      handle: guarded.handle
    })
  }
}

function adapter(handlerId: string): HandlerFactory {
  return ({ adapterHandlers }) => {
    const registration = adapterHandlers.get(handlerId)
    if (!registration) {
      throw new Error(`No product handler adapter registered for "${handlerId}".`)
    }
    return registration.handle
  }
}

function read(handle: (input: unknown, deps: ReadHandlerDeps) => Promise<unknown>): HandlerFactory {
  return (deps) => (input) =>
    handle(input, { jobRuntime: deps.jobRuntime, getAppLanguage: deps.getAppLanguage })
}
