import type { JobRuntime } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { getIntelligenceModule } from '../intelligenceModule'
import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import { analysisModelVocabulary } from '../analysis/analysisModelVocabulary'
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
type MacroCalendarInput = { month: string; asOf: string; from?: string; to?: string; maxEvents?: number }
type NewsSentimentInput = {
  asOf: string
  window: '1h' | '4h' | '24h' | '7d' | 'all'
  scope?: 'market' | 'BTC' | 'ETH'
  direction?: 'all' | 'bullish' | 'bearish' | 'neutral' | 'mixed'
  sourceId?: string
  limit?: number
}
type NewsSentimentItemInput = { itemId: string; asOf: string }
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

/**
 * One month, two calendars.
 *
 * The month view has always drawn official releases (BLS/Fed/BEA) and the market calendar (0xRouter)
 * side by side. The agent tool must answer from both: a month whose only scheduled events come from
 * the market provider must not read as "nothing planned". Each side keeps its own envelope under
 * `official` / `market`, and `events` is the merged, source-tagged view.
 */
export async function handleQueryMacroCalendar(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { month, asOf, from, to, maxEvents } = (input ?? {}) as MacroCalendarInput
  const queryService = getIntelligenceModule(deps.jobRuntime).publicQueryService
  const locale = (await deps.getAppLanguage()) === 'en-US' ? 'en' : 'zh'
  const caveats: string[] = []

  const official = await queryService.queryMacroEconomicCalendarMonth({
    month,
    asOf,
    ...(maxEvents === undefined ? {} : { maxEvents })
  })

  const market = readAllMarketCalendarPages(queryService, { month, asOf, locale })
  if (market.state === 'unavailable') caveats.push('market-calendar-unavailable')

  const officialEvents = filterCalendarEvents(readCalendarEvents(official), from, to)
  const marketEvents = filterCalendarEvents(market.events, from, to)
  if (officialEvents.length === 0) caveats.push('official-calendar-empty')
  if (marketEvents.length === 0) caveats.push('market-calendar-empty')

  const merged = [
    ...officialEvents.map((event) => summarizeCalendarEvent(event, 'official')),
    ...marketEvents.map((event) => summarizeCalendarEvent(event, 'market'))
  ].sort((left, right) => (left.scheduledAt ?? '').localeCompare(right.scheduledAt ?? ''))
  const limit = maxEvents ?? CALENDAR_DEFAULT_MAX_EVENTS
  const events = merged.slice(0, limit)

  // The raw pages carry provider identity, query envelopes and per-event provenance; the model only
  // needs the counts and the merged timeline, and the full pages overflow the tool size budget.
  return {
    state: events.length > 0 ? 'available' : 'empty',
    month,
    asOf,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    official: summarizeCalendarSide(official, officialEvents.length),
    market: { ...summarizeCalendarSide(market, marketEvents.length), pages: market.pages },
    events,
    truncated: merged.length > events.length,
    totalEvents: merged.length,
    caveats
  }
}

const CALENDAR_DEFAULT_MAX_EVENTS = 120
const CALENDAR_MAX_PAGES = 40
const CALENDAR_MAX_COLLECTED = 1_000

/**
 * The market query is paged by a byte budget, so one call only answers with the first page. A month
 * keeps every event, and the caller asking "what is scheduled today" must still see today's rows
 * even when they sit on a later page.
 */
function readAllMarketCalendarPages(
  queryService: ReturnType<typeof getIntelligenceModule>['publicQueryService'],
  input: { month: string; asOf: string; locale: 'zh' | 'en' }
): { state: 'available' | 'unavailable'; events: Array<Record<string, unknown>>; pages: number; failureCode?: string } {
  const events: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  let pages = 0
  try {
    do {
      const page = queryService.queryMarketCalendarMonth({
        month: input.month,
        asOf: input.asOf,
        locale: input.locale,
        ...(cursor ? { cursor } : {})
      })
      if (!page || page.state !== 'available') {
        return {
          state: 'unavailable',
          events: [],
          pages,
          ...(page && typeof page.failureCode === 'string' ? { failureCode: page.failureCode } : {})
        }
      }
      pages += 1
      events.push(...readCalendarEvents(page))
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined
    } while (cursor && pages < CALENDAR_MAX_PAGES && events.length < CALENDAR_MAX_COLLECTED)
    return { state: 'available', events, pages }
  } catch {
    return { state: 'unavailable', events: [], pages }
  }
}

function filterCalendarEvents(
  events: Array<Record<string, unknown>>,
  from: string | undefined,
  to: string | undefined
): Array<Record<string, unknown>> {
  if (!from && !to) return events
  // Compare instants, not strings: `scheduledAt` is UTC while the caller's window may carry an
  // offset, and lexicographic comparison across offsets lands on the wrong day.
  const fromMs = from ? Date.parse(from) : undefined
  const toMs = to ? Date.parse(to) : undefined
  return events.filter((event) => {
    const scheduledAt = typeof event.scheduledAt === 'string' ? event.scheduledAt : undefined
    const scheduledDate = typeof event.scheduledDate === 'string' ? event.scheduledDate : undefined
    const point = scheduledAt ?? (scheduledDate ? `${scheduledDate}T00:00:00.000Z` : undefined)
    const pointMs = point ? Date.parse(point) : Number.NaN
    if (!Number.isFinite(pointMs)) return false
    if (fromMs !== undefined && pointMs < fromMs) return false
    if (toMs !== undefined && pointMs >= toMs) return false
    return true
  })
}

function summarizeCalendarSide(page: unknown, eventCount: number): {
  state: string
  eventCount: number
  failureCode?: string
} {
  const record = page && typeof page === 'object' ? (page as Record<string, unknown>) : {}
  const state = typeof record.state === 'string' ? record.state : 'unavailable'
  const failureCode = typeof record.failureCode === 'string' ? record.failureCode : undefined
  return { state, eventCount, ...(failureCode ? { failureCode } : {}) }
}

function readCalendarEvents(page: unknown): Array<Record<string, unknown>> {
  if (!page || typeof page !== 'object') return []
  const events = (page as { events?: unknown }).events
  if (!Array.isArray(events)) return []
  return events.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
}

function summarizeCalendarEvent(
  event: Record<string, unknown>,
  source: 'official' | 'market'
): {
  source: 'official' | 'market'
  eventKey: string
  title: string
  scheduledAt: string | null
  scheduledDate?: string
  countryName?: string
  importance?: string
  lifecycleState?: string
  actual?: string
  previous?: string
  consensus?: string
  surprise?: string
} {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined
  const displayValue = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined
    return text((value as { displayValue?: unknown }).displayValue)
  }
  const titleKey = text(event.titleKey)
  const title = text(event.title) ?? text(event.name) ?? (titleKey ? analysisModelVocabulary.eventName[titleKey] ?? titleKey : '')
  return {
    source,
    eventKey: text(event.eventKey) ?? '',
    title,
    scheduledAt: text(event.scheduledAt) ?? null,
    ...(text(event.scheduledDate) ? { scheduledDate: text(event.scheduledDate) } : {}),
    ...(text(event.countryName) ? { countryName: text(event.countryName) } : {}),
    ...(text(event.importance) ? { importance: text(event.importance) } : {}),
    ...(text(event.lifecycleState) ? { lifecycleState: text(event.lifecycleState) } : {}),
    ...(displayValue(event.actual) ? { actual: displayValue(event.actual) } : {}),
    ...(displayValue(event.previous) ? { previous: displayValue(event.previous) } : {}),
    ...(displayValue(event.consensus) ? { consensus: displayValue(event.consensus) } : {}),
    ...(text(event.surprise) ? { surprise: text(event.surprise) } : {})
  }
}

export async function handleQueryNewsSentiment(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const parsed = (input ?? {}) as NewsSentimentInput
  const query = getIntelligenceModule(deps.jobRuntime).newsSentiment.query
  if (!query) {
    return {
      state: 'unavailable',
      asOf: parsed.asOf,
      window: parsed.window,
      items: [],
      caveats: ['news-sentiment-unavailable']
    }
  }
  return query.query(parsed as never)
}

export async function handleGetNewsSentimentItem(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { itemId, asOf } = (input ?? {}) as NewsSentimentItemInput
  const query = getIntelligenceModule(deps.jobRuntime).newsSentiment.query
  if (!query) return { state: 'unavailable', itemId }
  const item = await query.getItem({ itemId, asOf })
  return item ? { state: 'available', item } : { state: 'unavailable', itemId }
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
