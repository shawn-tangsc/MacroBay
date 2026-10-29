import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import { getIntelligenceModule } from '../intelligenceModule'
import { intelligenceAgentCapabilities } from './capabilityCatalog'
import type { CapabilityDomain } from './capabilityTypes'
import { projectTimelineRow } from './projections'
import { buildMarketPulseRows } from '../../../contracts/marketPulse'
import { dailyBriefingEnabledFromProfiles } from '../daily-briefing/dailyBriefingReadingSources'
import { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'
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
  if (!snapshot) {
    return {
      state: 'unavailable',
      interface: interfaceStatus,
      caveats: ['cross-asset-snapshot-unavailable']
    }
  }
  return { state: 'available', snapshot, interface: interfaceStatus, caveats: [] }
}

export async function handleGetDashboardFeedStatus(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const feeds = await getIntelligenceModule(deps.jobRuntime).dashboardFeedStatus.status()
  return { state: feeds.length > 0 ? 'available' : 'empty', feeds }
}

/** The newest published judgement at or before `asOf`; no analysis run, no briefing write. */
export async function handleGetLatestConclusion(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const asOf = (input as { asOf?: unknown } | null)?.asOf
  if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))) throw new Error('latest-conclusion-invalid-as-of')
  const repository = getIntelligenceModule(deps.jobRuntime).marketAnalysisRuntime.repository
  const boundary = Date.parse(asOf)
  const page = repository.listTimeline({ limit: 50 })
  const latest = selectLatestPublishedEntry(page.items.filter((entry) => {
    const at = Date.parse(entry.occurredAt)
    return Number.isFinite(at) && at <= boundary
  }))
  if (!latest?.summaryRef) return Object.freeze({ state: 'empty' as const, asOf, caveats: Object.freeze(['no-published-conclusion']) })
  const summary = repository.getSummary(latest.summaryRef)
  if (!summary) return Object.freeze({ state: 'empty' as const, asOf, caveats: Object.freeze(['summary-not-found']) })
  const predictions = repository.listPredictions(latest.summaryRef)
  const conclusion = summary.conclusion
  return Object.freeze({
    state: 'available' as const,
    asOf,
    summaryId: summary.id,
    publishedAt: summary.createdAt,
    direction: conclusion?.direction ?? latest.direction ?? 'undecided',
    summary: conclusion?.summary ?? summary.eventAssessment ?? '',
    ...(conclusion?.change ? { change: conclusion.change } : {}),
    conditions: Object.freeze([...(conclusion?.conditions ?? [])]),
    invalidations: Object.freeze(predictions.map((prediction) => Object.freeze({
      asset: prediction.asset,
      horizonEnd: prediction.horizonEnd,
      text: prediction.invalidation
    }))),
    counterEvidence: Object.freeze(summary.counterEvidence.map((claim) => Object.freeze({
      statement: claim.statement,
      evidenceRefId: claim.evidenceRefId
    }))),
    directions: Object.freeze(summary.directions.map((entry) => Object.freeze({
      horizon: entry.horizon,
      direction: entry.direction,
      confidence: entry.confidence,
      rationale: entry.rationale
    }))),
    caveats: Object.freeze(conclusion ? [] : ['legacy-conclusion'])
  })
}

/**
 * The agent's view of today's readings. It is deliberately not the document service: this tool
 * never generates, writes or fetches; it reads what the existing queries can answer at `asOf`.
 */
export async function handleGetDailyPulse(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const asOf = (input as { asOf?: unknown } | null)?.asOf
  if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))) throw new Error('daily-pulse-invalid-as-of')
  const module = getIntelligenceModule(deps.jobRuntime)
  const [fearGreed, funding, capital, news, profiles] = await Promise.all([
    readOr(() => module.publicQueryService.queryFearGreedSnapshot({ asOf }), {
      state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const
    }),
    readOr(() => module.publicQueryService.queryFundingRateHistory({ asOf }), {
      state: 'unavailable' as const, failureCode: 'funding-rate-history-query-unavailable' as const
    }),
    readOr(() => module.publicQueryService.queryCapitalConditionsSnapshot({ asOf }), {
      state: 'unavailable' as const, failureCode: 'capital-conditions-query-unavailable' as const
    }),
    readDailyPulseNews(module, asOf),
    readDailyPulseProfiles(module)
  ])
  const rows = buildMarketPulseRows({
    asOf,
    enabled: dailyBriefingEnabledFromProfiles(profiles),
    fearGreed,
    funding,
    capital
  })
  const readings = rows.map((row) => Object.freeze({
    id: row.id,
    group: row.id === 'fear-greed' ? 'sentiment' as const : 'funds' as const,
    labelKey: row.labelKey,
    state: row.state,
    value: row.value,
    change: row.change,
    ...(row.changeReason ? { changeReason: row.changeReason } : {}),
    window: row.window,
    observedAt: row.observedAt,
    ...(row.reason ? { reason: row.reason } : {})
  }))
  const hasValue = readings.some((row) => row.state === 'available' || row.state === 'stale')
  const hasGap = readings.some((row) => row.state === 'unavailable' || row.state === 'source-disabled')
  return Object.freeze({
    state: hasValue ? (hasGap ? 'partial' : 'available') : 'unavailable',
    asOf,
    readings: Object.freeze(readings),
    news,
    caveats: Object.freeze([
      ...(hasGap ? ['reading-gap'] : []),
      ...(news.state === 'available' || news.state === 'empty' ? [] : ['news-unavailable']),
      ...(profiles ? [] : ['source-switches-unknown'])
    ])
  })
}

async function readDailyPulseProfiles(module: ReturnType<typeof getIntelligenceModule>) {
  try {
    return await module.sourceProfileStore.listProfiles()
  } catch {
    return undefined
  }
}

async function readDailyPulseNews(
  module: ReturnType<typeof getIntelligenceModule>,
  asOf: string
): Promise<Readonly<{ state: 'available' | 'empty' | 'unavailable' | 'source-disabled'; counts?: Readonly<{ bearish: number; bullish: number; mixed: number; neutral: number }>; itemCount?: number }>> {
  const query = module.newsSentiment.query
  if (!query) return Object.freeze({ state: 'unavailable' as const })
  try {
    const view = await query.query({ asOf, window: '24h', limit: 100 })
    const counts = { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }
    for (const item of view.items) counts[item.polarity] += 1
    return Object.freeze({ state: view.state, counts: Object.freeze(counts), itemCount: view.items.length })
  } catch {
    return Object.freeze({ state: 'unavailable' as const })
  }
}

async function readOr<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
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
