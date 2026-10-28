import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import { getIntelligenceModule } from '../intelligenceModule'
import { intelligenceAgentCapabilities } from './capabilityCatalog'
import type { CapabilityDomain } from './capabilityTypes'
import { projectTimelineRow } from './projections'
import {
  DOMAIN_ORDER,
  type CrossAssetInput,
  type DescribeCapabilitiesInput,
  type ReadHandlerDeps,
  type TimelineInput
} from './readHandlerContracts'

export type { ReadHandlerDeps } from './readHandlerContracts'
export {
  handleGetOperationsHealth,
  handleListIntelligenceSources,
  handleGetSourceDetail
} from './readSourceHandlers'
export {
  handleQueryMacroCalendar,
  handleGetCalendarState
} from './readCalendarHandlers'
export {
  handleQueryNewsSentiment,
  handleGetNewsSentimentItem
} from './readNewsHandlers'

export async function handleGetIntelligenceTimeline(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { view = 'timeline', limit = 50, filters } = (input ?? {}) as TimelineInput
  const service = getIntelligenceService(deps.jobRuntime)

  if (view === 'workspace') {
    const rows = await service.getWorkspaceTimeline((filters ?? {}) as never)
    return {
      state: rows.length > 0 ? 'available' : 'empty',
      items: rows.map(projectTimelineRow),
      caveats: []
    }
  }

  const scope = filters?.scope
  const page = await service.getTimeline({
    ...(typeof scope === 'string' ? { filter: scope as never } : {}),
    limit
  })
  return {
    state: page.items.length > 0 ? 'available' : 'empty',
    items: page.items.map(projectTimelineItem),
    caveats: []
  }
}

/**
 * One month, two calendars.
 *
 * The month view has always drawn official releases (BLS/Fed/BEA) and the market calendar (0xRouter)
 * side by side. The agent tool must answer from both: a month whose only scheduled events come from
 * the market provider must not read as "nothing planned". Each side keeps its own envelope under
 * `official` / `market`, and `events` is the merged, source-tagged view.
 */

export async function handleGetTranslationStatus(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const translationService = getIntelligenceModule(deps.jobRuntime).translationService
  const [module, settings, queue] = await Promise.all([
    translationService.getModuleStatus(),
    translationService.getSettings(),
    translationService.getStatus()
  ])
  return {
    state: 'available',
    module,
    settings: {
      autoTranslateEnabled: settings.autoTranslateEnabled,
      targetLocale: settings.targetLocale,
      resolvedTargetLocale: settings.resolvedTargetLocale,
      providerId: settings.providerId,
      modelId: settings.modelId,
      defaultModelId: settings.defaultModelId,
      translateTitle: settings.translateTitle,
      translateSummary: settings.translateSummary,
      translateEvidenceExcerpt: settings.translateEvidenceExcerpt
    },
    queue,
    caveats: []
  }
}

/**
 * The calendar provider switches and the reader's own release-time edits.
 *
 * The events themselves are `query_macro_calendar`; this answers "is the provider on,
 * and did the reader move a release?". A provider that never stored a profile is
 * reported as configured=false with enabled=null — not as disabled.
 */

type CrossAssetInterfaceStatus = {
  state: 'configured' | 'default' | 'unknown'
  enabled: boolean | null
  lease: 'none' | 'active' | 'expired' | 'unknown'
}

async function readCrossAssetInterface(deps: ReadHandlerDeps): Promise<CrossAssetInterfaceStatus> {
  let state: CrossAssetInterfaceStatus['state'] = 'unknown'
  let enabled: boolean | null = null
  try {
    const configuration = await deps.crossAssetOps.readConfiguration()
    if (configuration.state !== 'unknown') {
      state = configuration.state
      enabled = configuration.enabled
    }
  } catch {
    // Unknown stays unknown: the reader must not be told the channel is closed.
  }
  let lease: CrossAssetInterfaceStatus['lease'] = 'unknown'
  try {
    lease = await deps.crossAssetOps.readLeaseState()
  } catch {
    // Same rule: an unreadable lease is not "no lease".
  }
  return { state, enabled, lease }
}

export async function handleGetCrossAssetSnapshot(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { range, asOf } = (input ?? {}) as CrossAssetInput
  const interfaceStatus = await readCrossAssetInterface(deps)
  const snapshot = await getIntelligenceModule(deps.jobRuntime).publicQueryService.queryCrossAssetSnapshot({
    range,
    asOf: asOf ?? new Date().toISOString()
  })
  // Even an unavailable snapshot carries the channel state; otherwise the model can only guess
  // whether there is no data or the interface never ran.
  if (!snapshot) return { state: 'unavailable', interface: interfaceStatus, caveats: [] }
  return { state: 'available', snapshot, interface: interfaceStatus, caveats: [] }
}

export async function handleGetDashboardFeedStatus(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const feeds = await getIntelligenceModule(deps.jobRuntime).dashboardFeedStatus.status()
  return { state: feeds.length > 0 ? 'available' : 'empty', feeds }
}

export async function handleDescribeIntelligenceCapabilities(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { domain = 'all' } = (input ?? {}) as DescribeCapabilitiesInput
  const language = await deps.getAppLanguage()
  const domains = DOMAIN_ORDER
    .filter((candidate) => domain === 'all' || domain === candidate)
    .map((candidate) => ({
      domain: candidate,
      capabilities: intelligenceAgentCapabilities
        .filter((capability) => capability.domain === candidate)
        .map((capability) => ({
          id: capability.id,
          kind: capability.kind,
          title: capability.title[language],
          description: capability.description,
          requiredFields: requiredFields(capability.inputSchema)
        }))
    }))
    .filter((group) => group.capabilities.length > 0)

  return { state: 'available', domains }
}

function requiredFields(schema: Record<string, unknown>): string[] {
  const required = schema.required
  return Array.isArray(required)
    ? required.filter((field): field is string => typeof field === 'string')
    : []
}

/** Event timeline items: keep the reading, drop the raw matcher output and decision ids. */
function projectTimelineItem(item: {
  event: {
    id: string
    sourceId: string
    sourceType: string
    title: string
    summary?: string
    url?: string
    publishedAt: string
    detectedAt: string
    category: string
    symbols: string[]
    assets: string[]
    sourceTrust: string
    marketWideCritical?: boolean
    impact?: unknown
  }
  alertStatus?: string
}): Record<string, unknown> {
  const { event } = item
  return {
    eventId: event.id,
    sourceId: event.sourceId,
    sourceType: event.sourceType,
    title: event.title,
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.url ? { url: event.url } : {}),
    publishedAt: event.publishedAt,
    detectedAt: event.detectedAt,
    category: event.category,
    symbols: [...event.symbols],
    assets: [...event.assets],
    sourceTrust: event.sourceTrust,
    ...(event.marketWideCritical === undefined ? {} : { marketWideCritical: event.marketWideCritical }),
    ...(event.impact === undefined ? {} : { impact: event.impact }),
    ...(item.alertStatus ? { alertStatus: item.alertStatus } : {})
  }
}
