import type {
  EventMatch,
  IntelligenceTimelineFilter,
  IntelligenceTimelineItem,
  IntelligenceTimelinePage,
  IntelligenceTimelineQuery,
  NormalizedMarketEvent
} from '../schema/marketEvent'
import { createMarketEventStore } from './marketEventStore'
import { isTimelineRelevant, matchMarketEvent } from './symbolExposureMatcher'
import type { EventMatchPolicy } from './symbolExposureMatcher'
import type { IntelligencePipeline } from './intelligencePipeline'
import type { IntelligenceTranslationService } from './intelligenceTranslationService'
import type { IntelligenceSourcesService } from './intelligenceSourcesService'
import {
  createIntelligenceWorkspaceQueries,
  type IntelligenceWorkspaceAlertRecord,
  type IntelligenceWorkspaceFilters,
  type IntelligenceWorkspaceView
} from './intelligenceWorkspaceQueries'
import {
  buildMonitoringScope,
  createEmptyWatchlistScope,
  EMPTY_EXPOSURE_SNAPSHOT,
  type MonitoringScope
} from './monitoringScope'

export type IntelligenceServiceDependencies = {
  marketEventStore: ReturnType<typeof createMarketEventStore>
  pipeline?: IntelligencePipeline
  sourcesService?: IntelligenceSourcesService
  translationService?: IntelligenceTranslationService
  getMonitoringScope?: () => Promise<MonitoringScope>
  getMatchPolicy?: () => Promise<EventMatchPolicy>
  listAlerts?: (input?: { limit?: number }) => Promise<IntelligenceWorkspaceAlertRecord[]>
}

const DEFAULT_MATCH_POLICY: EventMatchPolicy = {
  positionAndWatchlistOnly: false,
  criticalMarketEventFallback: true
}

export function createIntelligenceService(deps: IntelligenceServiceDependencies) {
  const workspaceQueries =
    deps.pipeline && deps.sourcesService
      ? createIntelligenceWorkspaceQueries({
          pipeline: deps.pipeline,
          sourcesService: deps.sourcesService,
          translationService: deps.translationService,
          listLegacyEvents: (limit) => deps.marketEventStore.listRecent(limit ?? 50)
        })
      : null

  async function buildMatchContext() {
    const [monitoringScope, matchPolicy, alerts] = await Promise.all([
      deps.getMonitoringScope?.() ??
        Promise.resolve(buildMonitoringScope(EMPTY_EXPOSURE_SNAPSHOT, createEmptyWatchlistScope())),
      deps.getMatchPolicy?.() ?? Promise.resolve(DEFAULT_MATCH_POLICY),
      deps.listAlerts?.({ limit: 200 }) ?? Promise.resolve([])
    ])
    return { monitoringScope, matchPolicy, alerts }
  }

  return {
    async getMonitoringScope() {
      const monitoringScope =
        (await deps.getMonitoringScope?.()) ??
        buildMonitoringScope(EMPTY_EXPOSURE_SNAPSHOT, createEmptyWatchlistScope())
      return {
        portfolioObservedAt: new Date().toISOString(),
        watchlistUpdatedAt: createEmptyWatchlistScope().updatedAt,
        scope: monitoringScope
      }
    },

    async getTimeline(query: IntelligenceTimelineQuery = {}): Promise<IntelligenceTimelinePage> {
      const filter: IntelligenceTimelineFilter = query.filter ?? 'both'
      const limit = query.limit ?? 50
      const [events, matchContext] = await Promise.all([
        deps.marketEventStore.listRecent(limit * 3),
        buildMatchContext()
      ])

      const items: IntelligenceTimelineItem[] = []
      for (const event of events) {
        const match = matchMarketEvent(event, matchContext.monitoringScope, matchContext.matchPolicy)
        if (!isTimelineRelevant(match, filter)) continue

        const alertDecision = findAlertForEvent(matchContext.alerts, event.id)
        items.push({
          event,
          match,
          alertStatus: alertDecision?.status ?? 'none',
          alertDecisionId: alertDecision?.id
        })
        if (items.length >= limit) break
      }

      return {
        items,
        filter,
        updatedAt: new Date().toISOString()
      }
    },

    async ingestNormalizedEvent(event: NormalizedMarketEvent) {
      return deps.marketEventStore.upsert(event)
    },

    async listRecentEvents(limit = 50) {
      return deps.marketEventStore.listRecent(limit)
    },

    async getWorkspaceState(input?: {
      view?: IntelligenceWorkspaceView
      filters?: IntelligenceWorkspaceFilters
      textMode?: 'translated' | 'original'
    }) {
      if (!workspaceQueries) throw new Error('Workspace queries are unavailable.')
      const matchContext = await buildMatchContext()
      return workspaceQueries.getWorkspaceStateAsync({
        view: input?.view,
        filters: input?.filters,
        matchContext,
        textMode: input?.textMode
      })
    },

    async getWorkspaceTimeline(filters?: IntelligenceWorkspaceFilters, textMode?: 'translated' | 'original') {
      if (!workspaceQueries) throw new Error('Workspace queries are unavailable.')
      const matchContext = await buildMatchContext()
      return workspaceQueries.getTimeline(filters ?? {}, matchContext, textMode)
    },

    async getSentimentAggregates(filters?: IntelligenceWorkspaceFilters) {
      if (!workspaceQueries) throw new Error('Workspace queries are unavailable.')
      return workspaceQueries.getSentimentAggregates(filters ?? {})
    },

    async getDetail(input: {
      clusterId?: string
      itemId?: string
      aggregateId?: string
      textMode?: 'translated' | 'original'
    }) {
      if (!workspaceQueries) throw new Error('Workspace queries are unavailable.')
      return workspaceQueries.getDetail(input)
    },

    async getOperationsHealth() {
      if (!workspaceQueries) throw new Error('Workspace queries are unavailable.')
      return workspaceQueries.getOperationsHealth()
    },

    async retryItemAssessment(input: { itemId: string }) {
      if (!deps.pipeline) throw new Error('Intelligence pipeline is unavailable.')
      return deps.pipeline.retryItemAssessment(input)
    }
  }
}

function findAlertForEvent(
  alerts: IntelligenceWorkspaceAlertRecord[],
  eventId: string
): IntelligenceWorkspaceAlertRecord | undefined {
  return alerts
    .filter((alert) => alert.correlationId === eventId || alert.safeFacts.eventId === eventId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

export type IntelligenceService = ReturnType<typeof createIntelligenceService>

export { createMarketEventJsonStorage } from './marketEventStore'
