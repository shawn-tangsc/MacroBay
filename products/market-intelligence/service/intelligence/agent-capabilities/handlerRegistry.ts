import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  ProductAgentToolHandler,
  ProductAgentToolHandlerRegistration
} from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { intelligenceAgentCapabilities, type CapabilityId } from './capabilityCatalog'
import type {
  GuardedHandler,
  IntelligenceAgentCapability,
  ToolCallContext
} from './capabilityTypes'
import { createAgentChangeLog, type AgentChangeLog } from './changeLog'
import { getIntelligenceProductDataDir } from '../intelligenceModule'
import { registerIntelligenceProductTools } from '../product-tools/registerIntelligenceProductTools'
import { isGuardedHandler, wrapProductToolHandler } from './wrapProductToolHandler'
import type { CrossAssetOps, MacroCalendarOps } from './operationFacades'
import { handleConfigureCrossAssetInterface } from './crossAssetWriteHandlers'
import { handleOperateMacroCalendar } from './calendarWriteHandlers'
import {
  handleConfigureIntelligenceSource,
  handleOperateIntelligenceSource,
  handleRequestSourceCredential
} from './sourceWriteHandlers'
import { handleConfigureTranslation } from './translationWriteHandlers'
import type { WriteHandlerDeps } from './writeAudit'
import { intelligenceWriteActionRules } from './writeCapabilitySchemas'
import {
  handleDescribeIntelligenceCapabilities,
  handleGetCalendarState,
  handleGetCrossAssetSnapshot,
  handleGetDashboardFeedStatus,
  handleGetDailyPulse,
  handleGetLatestConclusion,
  handleGetIntelligenceTimeline,
  handleGetOperationsHealth,
  handleGetSourceDetail,
  handleGetTranslationStatus,
  handleListIntelligenceSources,
  handleQueryMacroCalendar,
  handleQueryNewsSentiment,
  handleGetNewsSentimentItem,
  type ReadHandlerDeps
} from './readHandlers'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceAgentToolHandlerDeps = {
  jobRuntime: JobRuntime
  getAppLanguage?: () => Promise<AppLanguage>
  macroCalendarOps: MacroCalendarOps
  crossAssetOps: CrossAssetOps
  /** Test seam; production opens the product-owned audit store lazily on the first write. */
  changeLog?: AgentChangeLog
}

type HandlerFactoryDeps = {
  jobRuntime: JobRuntime
  getAppLanguage: () => Promise<AppLanguage>
  adapterHandlers: ReadonlyMap<string, ProductAgentToolHandlerRegistration>
  writeDeps: WriteHandlerDeps
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
  get_calendar_state: read(handleGetCalendarState),
  query_news_sentiment: read(handleQueryNewsSentiment),
  get_news_sentiment_item: read(handleGetNewsSentimentItem),
  get_translation_status: read(handleGetTranslationStatus),
  get_cross_asset_snapshot: read(handleGetCrossAssetSnapshot),
  get_dashboard_feed_status: read(handleGetDashboardFeedStatus),
  get_daily_pulse: read(handleGetDailyPulse),
  get_latest_conclusion: read(handleGetLatestConclusion),
  describe_intelligence_capabilities: read(handleDescribeIntelligenceCapabilities),
  configure_intelligence_source: write(handleConfigureIntelligenceSource),
  operate_intelligence_source: write(handleOperateIntelligenceSource),
  operate_macro_calendar: write(handleOperateMacroCalendar),
  configure_translation: write(handleConfigureTranslation),
  configure_cross_asset_interface: write(handleConfigureCrossAssetInterface),
  request_source_credential: write(handleRequestSourceCredential)
}

/** A capability without a handler binding cannot be registered at all. */
export function assertCapabilityRegistration(
  capability: Pick<IntelligenceAgentCapability, 'id' | 'handlerId'>
): void {
  if (typeof capability.handlerId !== 'string' || capability.handlerId.trim().length === 0) {
    throw new Error(`Capability "${capability.id}" declares no handlerId.`)
  }
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

  // One audit store per registration, opened on the first write that needs it rather than at boot.
  let openedChangeLog: AgentChangeLog | undefined
  const openChangeLog = (): AgentChangeLog => {
    if (deps.changeLog) return deps.changeLog
    openedChangeLog ??= createAgentChangeLog(
      join(getIntelligenceProductDataDir(), 'agent-change-log.sqlite')
    )
    return openedChangeLog
  }
  const writeDeps: WriteHandlerDeps = {
    jobRuntime: deps.jobRuntime,
    macroCalendarOps: deps.macroCalendarOps,
    crossAssetOps: deps.crossAssetOps,
    openChangeLog
  }

  const registeredHandlerIds = new Set<string>()
  for (const capability of intelligenceAgentCapabilities) {
    assertCapabilityRegistration(capability)
    if (registeredHandlerIds.has(capability.handlerId)) {
      throw new Error(`Duplicate handlerId declared for capability "${capability.id}".`)
    }
    const factory = handlerFactories[capability.id]
    if (!factory) {
      throw new Error(`No handler factory for capability "${capability.id}".`)
    }
    const guarded: GuardedHandler = wrapProductToolHandler({
      capability,
      handle: factory({ jobRuntime: deps.jobRuntime, getAppLanguage, adapterHandlers, writeDeps }),
      actionRules: intelligenceWriteActionRules[capability.id]
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
    handle(input, {
      jobRuntime: deps.jobRuntime,
      getAppLanguage: deps.getAppLanguage,
      macroCalendarOps: deps.writeDeps.macroCalendarOps,
      crossAssetOps: deps.writeDeps.crossAssetOps
    })
}

function write(
  handle: (input: unknown, deps: WriteHandlerDeps, context: ToolCallContext) => Promise<unknown>
): HandlerFactory {
  return (deps) => (input, context) => handle(input, deps.writeDeps, context)
}
