import type { JobRuntime } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { getIntelligenceModule } from '../intelligenceModule'
import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import { computeConfigurationRevision } from './configurationRevision'
import { intelligenceAgentCapabilities } from './capabilityCatalog'
import type { CapabilityDomain } from './capabilityTypes'
import { projectSourceDetail, projectSourceSummary, projectTimelineRow } from './projections'

export type ReadHandlerDeps = {
  jobRuntime: JobRuntime
  getAppLanguage: () => Promise<AppLanguage>
}

const DOMAIN_ORDER: readonly CapabilityDomain[] = [
  'query',
  'source-config',
  'calendar',
  'translation',
  'cross-asset',
  'operations'
]

const STUCK_RUN_MS = 15 * 60_000
const RUN_SAMPLE_LIMIT = 200

type ListSourcesInput = { domain?: 'all' | 'dashboard' | 'calendar'; includeDisabled?: boolean }
type SourceDetailInput = { sourceId: string }
type TimelineInput = {
  view?: 'timeline' | 'workspace'
  limit?: number
  filters?: Record<string, unknown>
}
type MacroCalendarInput = { month: string; asOf: string; maxEvents?: number }
type CrossAssetInput = { range: '1h' | '24h' | '7d'; asOf?: string }
type DescribeCapabilitiesInput = {
  domain?: 'all' | CapabilityDomain
}

export async function handleGetOperationsHealth(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const health = await getIntelligenceService(deps.jobRuntime).getOperationsHealth()
  const ownedRuns = deps.jobRuntime
    .listRecentRuns(RUN_SAMPLE_LIMIT)
    .filter((run) => run.productId === 'market-intelligence' || run.handlerId.startsWith('market-intelligence.'))
  const running = ownedRuns.filter((run) => run.status === 'running')
  const nowMs = Date.now()
  const lastJobAt = running
    .map((run) => run.startedAt ?? run.createdAt)
    .sort()
    .at(-1)
  const failedSource = health.sources.some(
    (source) => source.runtimeStatus === 'failed' || source.consecutiveFailures >= 3
  )
  const stuckRun = running.some((run) => {
    const startedMs = Date.parse(run.startedAt ?? run.createdAt)
    return Number.isFinite(startedMs) && nowMs - startedMs > STUCK_RUN_MS
  })

  return {
    state: health.sources.length > 0 ? 'available' : 'empty',
    generatedAt: new Date().toISOString(),
    operations: {
      registeredSchedules: deps.jobRuntime
        .listSchedules()
        .filter((definition) => definition.productId === 'market-intelligence' || definition.id.startsWith('market-intelligence.')).length,
      runningJobs: running.length,
      ...(lastJobAt ? { lastJobAt } : {}),
      stuck: failedSource || stuckRun
    },
    caveats: ['per-source-detail-use-get-source-detail']
  }
}

export async function handleListIntelligenceSources(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { domain = 'all', includeDisabled = false } = (input ?? {}) as ListSourcesInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const [definitions, profiles, focusSettings] = await Promise.all([
    Promise.resolve(sourcesService.listDefinitions()),
    sourcesService.listProfiles(),
    sourcesService.getFocusSettings()
  ])
  const definitionById = new Map(definitions.map((definition) => [definition.sourceId, definition]))
  const revision = computeConfigurationRevision({
    profiles,
    focusMarkets: focusSettings.enabledFocusMarkets
  })

  const sources = profiles
    .filter((profile) => includeDisabled || profile.enabled === true)
    .flatMap((profile) => {
      const definition = definitionById.get(profile.sourceId)
      if (!definition) return []
      return [projectSourceSummary({ profile, definition })]
    })
    .filter((source) => domain === 'all' || source.domains.includes(domain))

  return {
    state: sources.length > 0 ? 'available' : 'empty',
    revision,
    focusMarkets: { enabledFocusMarkets: [...focusSettings.enabledFocusMarkets] },
    sources
  }
}

export async function handleGetSourceDetail(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { sourceId } = (input ?? {}) as SourceDetailInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const known = sourcesService.listDefinitions().some((definition) => definition.sourceId === sourceId)
  if (!known) {
    return { state: 'unavailable', caveats: ['unknown-source'] }
  }

  const detail = await sourcesService.getDetail(sourceId)
  return {
    state: 'available',
    source: projectSourceDetail({
      definition: detail.definition,
      profile: detail.profile,
      health: detail.health,
      runtimeConfig: detail.runtimeConfig,
      ...(detail.scheduleRule ? { scheduleRule: detail.scheduleRule } : {}),
      ...(detail.credentialStatus ? { credentialStatus: detail.credentialStatus } : {})
    }),
    caveats: []
  }
}

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

export async function handleQueryMacroCalendar(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { month, asOf, maxEvents } = (input ?? {}) as MacroCalendarInput
  return getIntelligenceModule(deps.jobRuntime).publicQueryService.queryMacroEconomicCalendarMonth({
    month,
    asOf,
    ...(maxEvents === undefined ? {} : { maxEvents })
  })
}

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

export async function handleGetCrossAssetSnapshot(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { range, asOf } = (input ?? {}) as CrossAssetInput
  const snapshot = await getIntelligenceModule(deps.jobRuntime).publicQueryService.queryCrossAssetSnapshot({
    range,
    asOf: asOf ?? new Date().toISOString()
  })
  if (!snapshot) return { state: 'unavailable' }
  return { state: 'available', snapshot, caveats: [] }
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
