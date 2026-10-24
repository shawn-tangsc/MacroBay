import { createRuntimeStateStore, hashPayload } from '@platform/jobs'
import type { RuntimeStateRecord } from '@platform/jobs'

import { getIntelligenceAdapter } from '../adapters/adapterRegistry'
import {
  binanceArticlesToRawRecords,
  isBinanceHtmlSource,
  parseBinanceArticleListResponse
} from '../adapters/binanceAnnouncementsParser'
import {
  githubReleasesToRawRecords,
  parseGithubReleasesResponse
} from '../adapters/githubReleasesParser'
import {
  isOkxAnnouncementsSource,
  okxAnnouncementsToRawRecords,
  parseOkxAnnouncementsResponse
} from '../adapters/okxAnnouncementsParser'
import { parseRssFeedToRawRecords } from '../adapters/rssPoller'
import { normalizeEventType } from './eventTypeNormalizer'
import {
  isBackfillItem,
  resolveIsBackfillLabel,
  mergeProcessingLabels,
  parseProcessingLabels,
  serializeProcessingLabels
} from './intelligenceItemLabels'
import {
  buildSourceCollectionCheckpoint,
  formatSourceCheckpointPreview
} from './intelligenceSourceCheckpoint'
import { normalizePublishedAt } from './publishedAtNormalizer'
import { resolveCluster } from './clusterResolver'
import { getIntelligenceSourceDefinition, isDefillamaStablecoinRetiredPath } from './sourceCatalog'
import { createRawRecordStore } from './rawRecordStore'
import { resolveRevision } from './revisionResolver'
import { createSourceProfileStore, createInMemoryProfileStorage } from './sourceProfileStore'
import { resolveAndValidateRuntimeConfig } from './sourceRuntimeConfig'
import { buildAssessmentFromImpacts, buildNeutralAssessment } from './buildAssessmentFromImpacts'
import {
  buildSentimentSignalFromAssessment,
  buildSentimentSignalFromImpact,
  DEFAULT_AGGREGATE_SCOPES,
  mapImpactHorizonToSentimentHorizon
} from './buildSentimentSignals'
import { evaluateImpact } from './impactRules/impactRuleEngine'
import type {
  IntelligencePipelineSnapshot,
  IntelligencePipelineStateStorage
} from '../store/intelligencePipelineStateStorage'
import { createEmptyIntelligencePipelineSnapshot } from '../store/intelligencePipelineStateStorage'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'
import type { IntelligenceRuntimeStateStorage } from '../store/intelligenceRuntimeStateStorage'
import type { IntelligenceRuntimeStateHistoryStorage } from '../store/intelligenceRuntimeStateHistoryStorage'
import {
  appendRuntimeStateRevision,
  resolveRuntimeStatesAsOf,
  seedRuntimeStateRevisions
} from '../store/intelligenceRuntimeStateHistory'
import type { IntelligenceEventCluster, IntelligenceItem, IntelligenceItemRevision, SafeRawRecordSummary } from '../schema/intelligenceRecord'
import { aggregateSentimentSignals } from './sentimentScoring'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { MetricIntelligenceEvent, MetricIntelligenceEventDraft } from '../schema/intelligenceMetricEvent'
import type { NormalizedIntelligenceItemDraft } from '../adapters/sourceAdapter'
import type { IntelligenceAssessment } from '../schema/intelligenceAssessment'
import type { SentimentSignalInput, IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import type { IntelligenceSourceConfig, IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import type { ParsedIntelligenceRecord } from '../adapters/sourceAdapter'
import type { IntelligenceEventPublisher } from './intelligenceEventPublisher'
import {
  classifyParsedIntelligence,
  enrichDraftWithClassification,
  SOURCE_CLASSIFIER_VERSION
} from './sourceClassifiers/classifyParsedIntelligence'
import type { ClassifiedSourceEvent } from './sourceClassifiers/sourceClassifierTypes'

export type IntelligencePipelineHealth = {
  sourceId: string
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  lastRunSummary?: string
  checkpointPreview?: string
  parserVersion?: string
  lastPublishedAt?: string
  cursor?: string
  supportsHistoricalBackfill?: boolean
  collectionGap?: boolean
}

export type IntelligencePipeline = {
  collectSource: (input: { sourceId: string; runId: string; fixtureText?: string }) => Promise<{ queuedJobs: string[] }>
  normalizeRawRecords: (input: { sourceId?: string; limit?: number }) => Promise<{
    processedCount: number
    queuedJobs: string[]
    newItemIds: string[]
  }>
  assessChangedItems: (input: { itemIds?: string[] }) => Promise<{ assessmentCount: number; failedCount: number }>
  retryItemAssessment: (input: { itemId: string }) => Promise<{ assessmentCount: number; failedCount: number }>
  refreshSentimentAggregates: (input: {
    scopeKey?: string
    horizon?: SentimentSignalInput['horizon']
    itemIds?: string[]
  }) => Promise<{ aggregateCount: number }>
  getHealth: (sourceId: string) => IntelligencePipelineHealth | undefined
  listItems: () => IntelligenceItem[]
  listClusters: () => IntelligenceEventCluster[]
  listAssessments: () => IntelligenceAssessment[]
  listSentimentAggregates: () => IntelligenceSentimentAggregate[]
  listMetricEvents: () => MetricIntelligenceEvent[]
  listImpacts: () => IntelligenceImpact[]
  listRevisions: () => IntelligenceItemRevision[]
  listRawRecordSummaries: () => SafeRawRecordSummary[]
  listRuntimeStates: () => RuntimeStateRecord[]
  listRuntimeStatesAsOf: (asOf: string) => RuntimeStateRecord[]
  reportConnectivityProbe: (sourceId: string, input: { ok: boolean; message: string }) => void
}

export function createIntelligencePipeline(deps?: {
  profileStore?: ReturnType<typeof createSourceProfileStore>
  rawRecordStore?: ReturnType<typeof createRawRecordStore>
  fetchText?: (url: string, sourceId: string) => Promise<string>
  fetchMetricTarget?: (
    target: import('../adapters/resolveMetricFetchTargets').MetricFetchTarget,
    sourceId: string
  ) => Promise<string>
  snapshot?: IntelligencePipelineSnapshot
  stateStorage?: IntelligencePipelineStateStorage
  runtimeStateSnapshot?: RuntimeStateRecord[]
  runtimeStateStorage?: IntelligenceRuntimeStateStorage
  runtimeStateHistorySnapshot?: RuntimeStateRecord[]
  runtimeStateHistoryStorage?: IntelligenceRuntimeStateHistoryStorage
  eventPublisher?: IntelligenceEventPublisher
}): IntelligencePipeline {
  const profileStore = deps?.profileStore ?? createSourceProfileStore(createInMemoryProfileStorage())
  const rawRecordStore = deps?.rawRecordStore ?? createRawRecordStore()
  const fetchText = deps?.fetchText
  const fetchMetricTarget = deps?.fetchMetricTarget
  const runtimeStateStore = createRuntimeStateStore()
  const retiredRuntimeStateSnapshot = (deps?.runtimeStateSnapshot ?? []).filter(
    (record) => isDefillamaStablecoinRetiredPath(record.resourceId)
  )
  const runtimeStateSnapshot = (deps?.runtimeStateSnapshot ?? []).filter(
    (record) => !isDefillamaStablecoinRetiredPath(record.resourceId)
  )
  const retiredRuntimeStateHistorySnapshot = (deps?.runtimeStateHistorySnapshot ?? []).filter(
    (record) => isDefillamaStablecoinRetiredPath(record.resourceId)
  )
  const runtimeStateHistorySnapshot = (deps?.runtimeStateHistorySnapshot ?? []).filter(
    (record) => !isDefillamaStablecoinRetiredPath(record.resourceId)
  )
  for (const record of runtimeStateSnapshot) {
    runtimeStateStore.upsert({
      owner: record.owner,
      productId: record.productId,
      resourceId: record.resourceId,
      status: record.status,
      checkpoint: record.checkpoint,
      cursorPreview: record.cursorPreview,
      lastSuccessAt: record.lastSuccessAt,
      lastFailureAt: record.lastFailureAt
    })
  }
  let runtimeStateRevisions = seedRuntimeStateRevisions(
    runtimeStateHistorySnapshot,
    runtimeStateSnapshot
  )
  const initialSnapshot = deps?.snapshot ?? createEmptyIntelligencePipelineSnapshot()
  const retiredOutput = splitRetiredPipelineOutput(initialSnapshot)

  const items = new Map(retiredOutput.active.items.map((item) => [item.itemId, item]))
  const clusters = new Map(retiredOutput.active.clusters.map((cluster) => [cluster.clusterId, cluster]))
  const revisions = [...retiredOutput.active.revisions]
  const assessments = [...retiredOutput.active.assessments]
  const sentimentSignals = [...retiredOutput.active.sentimentSignals]
  const sentimentAggregates = new Map(
    retiredOutput.active.sentimentAggregates.map((aggregate) => [aggregate.aggregateId, aggregate])
  )
  const metricEvents = [...retiredOutput.active.metricEvents]
  const impacts = [...retiredOutput.active.impacts]
  const previousHealthStatus = new Map<string, IntelligencePipelineHealth['runtimeStatus']>()

  async function publishEventsAfterPersist(input: {
    newItemIds?: string[]
    impacts?: Array<{ impact: IntelligenceImpact; item: IntelligenceItem }>
    aggregates?: Array<{ aggregate: IntelligenceSentimentAggregate; previous?: IntelligenceSentimentAggregate }>
    sourceIds?: string[]
  }): Promise<void> {
    const publisher = deps?.eventPublisher
    if (!publisher) return

    for (const itemId of input.newItemIds ?? []) {
      const item = items.get(itemId)
      if (item) {
        await publisher.publishItemCreated(item)
        if (item.clusterId) {
          const cluster = clusters.get(item.clusterId)
          if (cluster) await publisher.publishClusterUpdated(cluster)
        }
      }
    }

    for (const entry of input.impacts ?? []) {
      await publisher.publishImpactCreated({
        impact: entry.impact,
        item: entry.item,
        title: entry.item.title,
        summary: entry.item.summary
      })
    }

    for (const entry of input.aggregates ?? []) {
      await publisher.publishSentimentUpdated(entry)
    }

    for (const sourceId of input.sourceIds ?? []) {
      const health = buildHealthSnapshot(sourceId)
      if (!health) continue
      const previousStatus = previousHealthStatus.get(sourceId)
      if (previousStatus === health.runtimeStatus) continue
      await publisher.publishSourceHealthChanged({ health, previousStatus })
      previousHealthStatus.set(sourceId, health.runtimeStatus)
    }
  }

  function buildHealthSnapshot(sourceId: string): IntelligencePipelineHealth | undefined {
    if (isDefillamaStablecoinRetiredPath(sourceId)) return undefined
    const state = runtimeStateStore.get('product', 'market-intelligence', sourceId)
    if (!state) return undefined
    const definition = getIntelligenceSourceDefinition(sourceId)
    const checkpoint = state.checkpoint as
      | {
          parserVersion?: string
          lastPublishedAt?: string
          cursor?: string
        }
      | undefined
    const isStreamSource = definition?.executionMode === 'websocket'
    return {
      sourceId,
      runtimeStatus: state.status === 'failed' ? 'failed' : state.consecutiveFailures > 0 ? 'degraded' : 'healthy',
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      consecutiveFailures: state.consecutiveFailures,
      lastRunSummary: state.cursorPreview,
      checkpointPreview: state.cursorPreview,
      parserVersion: checkpoint?.parserVersion,
      lastPublishedAt: checkpoint?.lastPublishedAt,
      cursor: checkpoint?.cursor,
      supportsHistoricalBackfill: !isStreamSource,
      collectionGap: isStreamSource
    }
  }

  function persistState(): Promise<void> {
    if (!deps?.stateStorage) return Promise.resolve()
    return deps.stateStorage.write({
      items: [...retiredOutput.legacy.items, ...items.values()],
      clusters: [...retiredOutput.legacy.clusters, ...clusters.values()],
      revisions: [...retiredOutput.legacy.revisions, ...revisions],
      assessments: [...retiredOutput.legacy.assessments, ...assessments],
      sentimentSignals: [...retiredOutput.legacy.sentimentSignals, ...sentimentSignals],
      sentimentAggregates: [...retiredOutput.legacy.sentimentAggregates, ...sentimentAggregates.values()],
      metricEvents: [...retiredOutput.legacy.metricEvents, ...metricEvents],
      impacts: [...retiredOutput.legacy.impacts, ...impacts],
      updatedAt: new Date().toISOString()
    })
  }

  async function persistRuntimeHealth(): Promise<void> {
    if (deps?.runtimeStateStorage) {
      await deps.runtimeStateStorage.writeAll([...retiredRuntimeStateSnapshot, ...runtimeStateStore.list()])
    }
    if (deps?.runtimeStateHistoryStorage) {
      await deps.runtimeStateHistoryStorage.writeAll([...retiredRuntimeStateHistorySnapshot, ...runtimeStateRevisions])
    }
  }

  async function recordRuntimeHealthRevision(sourceId: string): Promise<void> {
    const next = runtimeStateStore.get('product', 'market-intelligence', sourceId)
    if (!next) return
    runtimeStateRevisions = appendRuntimeStateRevision(runtimeStateRevisions, next)
    await persistRuntimeHealth()
  }

  async function recordCollectionFailure(sourceId: string, message: string): Promise<void> {
    runtimeStateStore.recordFailure('product', 'market-intelligence', sourceId, message)
    await recordRuntimeHealthRevision(sourceId)
    await publishEventsAfterPersist({ sourceIds: [sourceId] })
  }

  async function recordCollectionSuccess(
    sourceId: string,
    checkpoint?: Record<string, unknown>,
    summary?: string
  ): Promise<void> {
    runtimeStateStore.recordSuccess('product', 'market-intelligence', sourceId, checkpoint, summary)
    await recordRuntimeHealthRevision(sourceId)
    await publishEventsAfterPersist({ sourceIds: [sourceId] })
  }

  async function assessChangedItemsImpl({ itemIds }: { itemIds?: string[] }) {
    const targetItems = itemIds?.length
      ? itemIds.map((itemId) => items.get(itemId)).filter(Boolean)
      : [...items.values()].filter((item) => {
          const labels = parseProcessingLabels(item.processingLabelsJson)
          return labels.assessmentStatus !== 'evaluated' || item.timelineStatus === 'new'
        })

    let assessmentCount = 0
    let failedCount = 0
    const publishedImpacts: Array<{ impact: IntelligenceImpact; item: IntelligenceItem }> = []
    for (const item of targetItems) {
      if (!item) continue

      const effectiveRevision = [...revisions]
        .filter((revision) => revision.itemId === item.itemId)
        .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))[0]
      const alreadyAssessed = assessments.some(
        (assessment) =>
          assessment.itemId === item.itemId &&
          assessment.effectiveRevisionId === effectiveRevision?.revisionId &&
          assessment.engineVersion === 'macro-sector-asset-v1'
      )
      if (alreadyAssessed && item.timelineStatus === 'evaluated') {
        continue
      }

      items.set(item.itemId, {
        ...item,
        processingLabelsJson: serializeProcessingLabels(
          mergeProcessingLabels(parseProcessingLabels(item.processingLabelsJson), {
            assessmentStatus: 'evaluating'
          })
        )
      })

      try {
        const definition = getIntelligenceSourceDefinition(item.sourceId)
        if (!definition) {
          throw new Error(`Unknown source definition for ${item.sourceId}`)
        }

        const labels = parseProcessingLabels(item.processingLabelsJson)
        const metricEvent = labels.metricEventId
          ? metricEvents.find((entry) => entry.metricEventId === labels.metricEventId)
          : metricEvents.find((entry) => entry.itemId === item.itemId)

        const ruleResults = evaluateImpact({
          item,
          metricEvent,
          sourceDefinition: definition
        })

        const createdImpacts: IntelligenceImpact[] = ruleResults.map((result, index) => ({
          impactId: `impact-${item.itemId}-${impacts.length + index + 1}`,
          itemId: item.itemId,
          clusterId: item.clusterId,
          metricEventId: metricEvent?.metricEventId,
          createdAt: new Date().toISOString(),
          ...result
        }))

        for (const impact of createdImpacts) {
          const existingIndex = impacts.findIndex((entry) => entry.impactId === impact.impactId)
          if (existingIndex >= 0) impacts[existingIndex] = impact
          else impacts.push(impact)
          publishedImpacts.push({ impact, item })
        }

        const assessment =
          createdImpacts.length > 0
            ? buildAssessmentFromImpacts({
                itemId: item.itemId,
                clusterId: item.clusterId,
                effectiveRevisionId: effectiveRevision?.revisionId,
                impacts: createdImpacts,
                assessmentCount: assessments.length
              })
            : buildNeutralAssessment({
                itemId: item.itemId,
                clusterId: item.clusterId,
                effectiveRevisionId: effectiveRevision?.revisionId,
                assessmentCount: assessments.length
              })

        assessments.push(assessment)
        items.set(item.itemId, {
          ...item,
          timelineStatus: 'evaluated',
          processingLabelsJson: serializeProcessingLabels(
            mergeProcessingLabels(parseProcessingLabels(item.processingLabelsJson), {
              assessmentStatus: 'evaluated',
              assessmentErrorCode: undefined
            })
          )
        })
        assessmentCount += 1
      } catch (error) {
        failedCount += 1
        items.set(item.itemId, {
          ...item,
          timelineStatus: 'new',
          processingLabelsJson: serializeProcessingLabels(
            mergeProcessingLabels(parseProcessingLabels(item.processingLabelsJson), {
              assessmentStatus: 'failed',
              assessmentErrorCode: error instanceof Error ? error.message : 'impact-evaluation-failed'
            })
          )
        })
      }
    }

    if (assessmentCount > 0 || failedCount > 0) {
      await persistState()
      await publishEventsAfterPersist({ impacts: publishedImpacts })
    }

    return { assessmentCount, failedCount }
  }

  return {
    async collectSource({ sourceId, runId, fixtureText }) {
      const queuedJobs: string[] = []
      if (isDefillamaStablecoinRetiredPath(sourceId)) {
        return { queuedJobs: [] }
      }
      const definition = getIntelligenceSourceDefinition(sourceId)
      if (!definition) throw new Error(`Unknown intelligence source "${sourceId}".`)

      const profile = await profileStore.resolveProfile(sourceId)
      const { config, issues } = resolveAndValidateRuntimeConfig({
        definition,
        profile,
        hasCredential: Boolean(profile.credentialRef)
      })
      if (issues.length > 0) {
        await recordCollectionFailure(sourceId, issues[0]?.message ?? 'Source is not ready to run.')
        return { queuedJobs: [] }
      }

      const adapter = getIntelligenceAdapter(sourceId)
      if (!adapter) throw new Error(`No adapter registered for "${sourceId}".`)

      try {
        const rawInputs = fixtureText
          ? buildFixtureRawRecords(sourceId, runId, fixtureText, adapter.parserVersion)
          : await adapter.collect({
              config,
              runId,
              fetchText: async (url) => {
                if (!fetchText) {
                  throw new Error('HTTP fetch is not configured for intelligence collection.')
                }
                return fetchText(url, sourceId)
              },
              fetchMetricTarget: fetchMetricTarget
                ? async (target, sid) => fetchMetricTarget(target, sid)
                : undefined
            })

        let appended = 0
        for (const rawInput of rawInputs) {
          const appendedRecord = rawRecordStore.appendRawRecord(rawInput)
          if (appendedRecord) appended += 1
        }

        if (appended > 0) {
          queueJob(queuedJobs, 'market-intelligence.normalizeRawRecords')
        }

        const checkpoint = buildSourceCollectionCheckpoint({
          rawInputs,
          parserVersion: adapter.parserVersion,
          appended
        })
        await recordCollectionSuccess(
          sourceId,
          checkpoint,
          formatSourceCheckpointPreview(checkpoint)
        )
        return { queuedJobs: [...queuedJobs] }
      } catch (error) {
        await recordCollectionFailure(
          sourceId,
          error instanceof Error ? error.message : 'Collection failed.'
        )
        return { queuedJobs: [] }
      }
    },

    async normalizeRawRecords({ sourceId, limit = 100 }) {
      const queuedJobs: string[] = []
      let processedCount = 0
      let stateDirty = false
      const newItemIds: string[] = []
      const pending = rawRecordStore
        .listUnprocessed()
        .filter((record) => !isDefillamaStablecoinRetiredPath(record.sourceId))
        .filter((record) => (sourceId ? record.sourceId === sourceId : true))
        .slice(0, limit)

      for (const rawRecord of pending) {
        const definition = getIntelligenceSourceDefinition(rawRecord.sourceId)
        const adapter = getIntelligenceAdapter(rawRecord.sourceId)
        if (!definition || !adapter) continue

        const profile = await profileStore.resolveProfile(rawRecord.sourceId)
        const { config } = resolveAndValidateRuntimeConfig({ definition, profile })

        const parsed = adapter.parseRawRecord({
          config,
          rawRecord: {
            ...rawRecord,
            payloadBody: rawRecord.payloadBody
          }
        })
        rawRecordStore.markParsed(rawRecord.rawRecordId)

        const drafts = adapter.normalizeParsedItems
          ? adapter.normalizeParsedItems({
              config,
              parsed,
              rawRecordId: rawRecord.rawRecordId,
              detectedAt: rawRecord.detectedAt
            })
          : [
              adapter.normalizeParsedItem({
                config,
                parsed,
                rawRecordId: rawRecord.rawRecordId,
                detectedAt: rawRecord.detectedAt
              })
            ]

        let recordProcessed = false
        let recordIgnored = false
        let ignoredAudit: ClassifiedSourceEvent | undefined
        for (const draft of drafts) {
          const classification = classifyParsedIntelligence({
            sourceId: rawRecord.sourceId,
            draft,
            parsed
          })

          if (classification.outcome === 'ignore') {
            recordIgnored = true
            ignoredAudit = classification
            continue
          }

          const enrichedDraft = enrichDraftWithClassification(draft, classification)
          const created = processNormalizedDraft({
            draft: enrichedDraft,
            parsed,
            rawRecord,
            config,
            adapterParserVersion: adapter.parserVersion,
            definition,
            classification,
            items,
            clusters,
            revisions,
            metricEvents,
            newItemIds
          })
          if (created) {
            recordProcessed = true
            stateDirty = true
          }
        }

        if (recordProcessed) {
          rawRecordStore.markNormalized(rawRecord.rawRecordId)
          processedCount += 1
          queueJob(queuedJobs, 'market-intelligence.assessChangedItems')
          queueJob(queuedJobs, 'market-intelligence.refreshSentimentAggregates')
          queueJob(queuedJobs, 'market-intelligence.translateItems')
          if ((NEWS_SENTIMENT_SOURCE_IDS as readonly string[]).includes(rawRecord.sourceId)) {
            queueJob(queuedJobs, 'market-intelligence.enrichNewsDocuments')
          }
        } else if (recordIgnored && ignoredAudit?.ignoredReasonCode) {
          rawRecordStore.markIgnored(rawRecord.rawRecordId, {
            ignoredReasonCode: ignoredAudit.ignoredReasonCode,
            classifierVersion: SOURCE_CLASSIFIER_VERSION,
            classifierNotes: ignoredAudit.eventSubtype
          })
        } else {
          rawRecordStore.markNormalized(rawRecord.rawRecordId)
        }
      }

      if (stateDirty) {
        await persistState()
        await publishEventsAfterPersist({ newItemIds: [...newItemIds] })
      }

      return { processedCount, queuedJobs: [...queuedJobs], newItemIds }
    },

    async assessChangedItems({ itemIds }) {
      return assessChangedItemsImpl({ itemIds })
    },

    async retryItemAssessment({ itemId }) {
      const item = items.get(itemId)
      if (!item) return { assessmentCount: 0, failedCount: 0 }

      for (let index = assessments.length - 1; index >= 0; index -= 1) {
        if (assessments[index]?.itemId === itemId) {
          assessments.splice(index, 1)
        }
      }
      for (let index = impacts.length - 1; index >= 0; index -= 1) {
        if (impacts[index]?.itemId === itemId) {
          impacts.splice(index, 1)
        }
      }

      items.set(itemId, {
        ...item,
        timelineStatus: 'new',
        processingLabelsJson: serializeProcessingLabels(
          mergeProcessingLabels(parseProcessingLabels(item.processingLabelsJson), {
            assessmentStatus: 'queued',
            assessmentErrorCode: undefined
          })
        )
      })

      return assessChangedItemsImpl({ itemIds: [itemId] })
    },

    async refreshSentimentAggregates({ scopeKey, horizon = '1h', itemIds }) {
      const targetItemIds = itemIds?.length ? new Set(itemIds) : undefined
      const newSignals: SentimentSignalInput[] = []

      for (const assessment of assessments) {
        if (targetItemIds && !targetItemIds.has(assessment.itemId)) continue
        const item = items.get(assessment.itemId)
        if (!item) continue

        const labels = parseProcessingLabels(item.processingLabelsJson)
        if (labels.sentimentEligible === false) continue

        const itemImpacts = impacts.filter((impact) => impact.itemId === assessment.itemId)
        if (itemImpacts.length > 0) {
          for (const impact of itemImpacts) {
            const impactHorizon = mapImpactHorizonToSentimentHorizon(impact.horizon)
            if (scopeKey && impact.scopeKey !== scopeKey && scopeKey !== 'global') continue
            if (
              sentimentSignals.some(
                (signal) => signal.impactId === impact.impactId && signal.horizon === impactHorizon
              )
            ) {
              continue
            }
            newSignals.push(buildSentimentSignalFromImpact(impact, item, assessment, impactHorizon))
          }
          continue
        }

        const fallbackScopeType = 'market-wide'
        const fallbackScopeKey = scopeKey ?? 'global'
        if (
          sentimentSignals.some(
            (signal) =>
              signal.assessmentId === assessment.assessmentId &&
              signal.scopeKey === fallbackScopeKey &&
              signal.horizon === horizon
          )
        ) {
          continue
        }
        newSignals.push(
          buildSentimentSignalFromAssessment(assessment, item, fallbackScopeType, fallbackScopeKey, horizon)
        )
      }

      if (newSignals.length > 0) {
        sentimentSignals.push(...newSignals)
      }

      const scopeTargets = collectAggregateScopes(sentimentSignals, scopeKey)
      const changedAggregates: Array<{
        aggregate: IntelligenceSentimentAggregate
        previous?: IntelligenceSentimentAggregate
      }> = []
      for (const target of scopeTargets) {
        for (const targetHorizon of collectAggregateHorizons(sentimentSignals, horizon)) {
          const aggregateSignals = sentimentSignals.filter(
            (signal) =>
              signal.scopeType === target.scopeType &&
              signal.scopeKey === target.scopeKey &&
              signal.horizon === targetHorizon
          )
          const aggregate = aggregateSentimentSignals({
            scopeType: target.scopeType,
            scopeKey: target.scopeKey,
            horizon: targetHorizon,
            signals: aggregateSignals
          })
          const previous = sentimentAggregates.get(aggregate.aggregateId)
          if (aggregate.signalCount > 0) {
            sentimentAggregates.set(aggregate.aggregateId, aggregate)
            if (
              !previous ||
              previous.updatedAt !== aggregate.updatedAt ||
              previous.aggregateScore !== aggregate.aggregateScore ||
              previous.aggregateLabel !== aggregate.aggregateLabel
            ) {
              changedAggregates.push({ aggregate, previous })
            }
          } else if (previous) {
            sentimentAggregates.delete(aggregate.aggregateId)
          }
        }
      }

      await persistState()
      await publishEventsAfterPersist({ aggregates: changedAggregates })
      return { aggregateCount: sentimentAggregates.size }
    },

    getHealth(sourceId) {
      return buildHealthSnapshot(sourceId)
    },

    listItems: () => [...items.values()],
    listClusters: () => [...clusters.values()],
    listAssessments: () => [...assessments],
    listSentimentAggregates: () => [...sentimentAggregates.values()],
    listMetricEvents: () => [...metricEvents],
    listImpacts: () => [...impacts],
    listRevisions: () => [...revisions],
    listRawRecordSummaries: () => rawRecordStore.listSafeSummaries(),
    listRuntimeStates: () =>
      runtimeStateStore
        .list()
        .filter((state) => !isDefillamaStablecoinRetiredPath(state.resourceId)),
    listRuntimeStatesAsOf: (asOf) =>
      resolveRuntimeStatesAsOf(runtimeStateRevisions, asOf).filter(
        (state) => !isDefillamaStablecoinRetiredPath(state.resourceId)
      ),

    reportConnectivityProbe(sourceId, { ok, message }) {
      if (isDefillamaStablecoinRetiredPath(sourceId)) return
      if (ok) {
        void recordCollectionSuccess(sourceId, undefined, message)
        return
      }
      void recordCollectionFailure(sourceId, message)
    }
  }
}

function splitRetiredPipelineOutput(snapshot: IntelligencePipelineSnapshot): {
  active: IntelligencePipelineSnapshot
  legacy: IntelligencePipelineSnapshot
} {
  const retiredItemIds = new Set(
    snapshot.items
      .filter((item) => isDefillamaStablecoinRetiredPath(item.sourceId))
      .map((item) => item.itemId)
  )
  const retiredImpactIds = new Set(
    snapshot.impacts
      .filter((impact) => retiredItemIds.has(impact.itemId))
      .map((impact) => impact.impactId)
  )
  const isLegacyItemId = (itemId: string) => retiredItemIds.has(itemId)
  const isLegacyAggregate = (aggregate: IntelligenceSentimentAggregate) =>
    hasRetiredSupport(aggregate.supportingItemIdsJson, retiredItemIds) ||
    hasRetiredSupport(aggregate.supportingImpactIdsJson, retiredImpactIds)

  return {
    active: {
      items: snapshot.items.filter((item) => !isLegacyItemId(item.itemId)),
      clusters: snapshot.clusters.filter((cluster) => !isDefillamaStablecoinRetiredPath(cluster.primarySourceId)),
      revisions: snapshot.revisions.filter((revision) => !isLegacyItemId(revision.itemId)),
      assessments: snapshot.assessments.filter((assessment) => !isLegacyItemId(assessment.itemId)),
      sentimentSignals: snapshot.sentimentSignals.filter((signal) => !isLegacyItemId(signal.itemId)),
      sentimentAggregates: snapshot.sentimentAggregates.filter((aggregate) => !isLegacyAggregate(aggregate)),
      metricEvents: snapshot.metricEvents.filter((metric) => !isLegacyItemId(metric.itemId)),
      impacts: snapshot.impacts.filter((impact) => !isLegacyItemId(impact.itemId)),
      updatedAt: snapshot.updatedAt
    },
    legacy: {
      items: snapshot.items.filter((item) => isLegacyItemId(item.itemId)),
      clusters: snapshot.clusters.filter((cluster) => isDefillamaStablecoinRetiredPath(cluster.primarySourceId)),
      revisions: snapshot.revisions.filter((revision) => isLegacyItemId(revision.itemId)),
      assessments: snapshot.assessments.filter((assessment) => isLegacyItemId(assessment.itemId)),
      sentimentSignals: snapshot.sentimentSignals.filter((signal) => isLegacyItemId(signal.itemId)),
      sentimentAggregates: snapshot.sentimentAggregates.filter((aggregate) => isLegacyAggregate(aggregate)),
      metricEvents: snapshot.metricEvents.filter((metric) => isLegacyItemId(metric.itemId)),
      impacts: snapshot.impacts.filter((impact) => isLegacyItemId(impact.itemId)),
      updatedAt: snapshot.updatedAt
    }
  }
}

function hasRetiredSupport(value: string | undefined, retiredIds: ReadonlySet<string>): boolean {
  if (!value || retiredIds.size === 0) return false
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.some((entry) => typeof entry === 'string' && retiredIds.has(entry))
  } catch {
    return false
  }
}

function processNormalizedDraft(input: {
  draft: NormalizedIntelligenceItemDraft
  parsed: ParsedIntelligenceRecord
  rawRecord: { rawRecordId: string; sourceId: string; detectedAt: string }
  config: IntelligenceSourceConfig
  adapterParserVersion: string
  definition: IntelligenceSourceDefinition
  classification: ClassifiedSourceEvent
  items: Map<string, IntelligenceItem>
  clusters: Map<string, IntelligenceEventCluster>
  revisions: IntelligenceItemRevision[]
  metricEvents: MetricIntelligenceEvent[]
  newItemIds: string[]
}): boolean {
  const publishedAt = normalizePublishedAt(input.draft.publishedAt) ?? input.draft.publishedAt
  const eventType = normalizeEventType({
    eventType: input.draft.eventType,
    sourceCategory: input.config.category,
    clusterType: input.draft.clusterType
  })
  const normalizedDraft = {
    ...input.draft,
    publishedAt,
    eventType
  }

  const existingItem = [...input.items.values()].find(
    (item) => item.canonicalDedupeKey === normalizedDraft.canonicalDedupeKey
  )
  const itemId = existingItem?.itemId ?? `item-${normalizedDraft.canonicalDedupeKey}`

  const revisionResult = resolveRevision({
    candidate: {
      itemId,
      canonicalDedupeKey: normalizedDraft.canonicalDedupeKey,
      title: normalizedDraft.title,
      summary: normalizedDraft.summary,
      bodyHash: input.parsed.bodyHash,
      publishedAt: normalizedDraft.publishedAt,
      detectedAt: normalizedDraft.detectedAt
    },
    existingRevisions: input.revisions
  })

  if (revisionResult.created && revisionResult.revision) {
    input.revisions.push(revisionResult.revision)
  }
  if (revisionResult.isDuplicate && existingItem) {
    return false
  }

  const metricEvent = persistMetricEventFromDraft({
    itemId,
    sourceId: input.rawRecord.sourceId,
    draftJson: normalizedDraft.metricEventJson,
    metricEvents: input.metricEvents
  })

  const processingLabels = serializeProcessingLabels(
    mergeProcessingLabels(parseProcessingLabels(existingItem?.processingLabelsJson), {
      isBackfill: resolveIsBackfillLabel({
        publishedAt: normalizedDraft.publishedAt,
        detectedAt: normalizedDraft.detectedAt,
        intelligenceLayer: normalizedDraft.intelligenceLayer ?? input.definition.intelligenceLayer,
        eventFamily: normalizedDraft.eventFamily ?? input.definition.eventFamily
      }),
      assessmentStatus: 'queued',
      intelligenceLayer: normalizedDraft.intelligenceLayer ?? input.definition.intelligenceLayer,
      dataDomain: normalizedDraft.dataDomain ?? input.definition.dataDomain,
      eventFamily: normalizedDraft.eventFamily ?? input.definition.eventFamily,
      eventSubtype: normalizedDraft.eventSubtype ?? input.classification.eventSubtype,
      metricEventId: metricEvent?.metricEventId,
      relevanceOutcome: input.classification.outcome,
      sentimentEligible: input.classification.sentimentEligible,
      classifierCaveats: input.classification.caveats.length > 0 ? input.classification.caveats : undefined,
      impactHintJson: normalizedDraft.impactHintJson
    })
  )

  const item: IntelligenceItem = existingItem ?? {
    itemId,
    primaryRawRecordId: input.rawRecord.rawRecordId,
    canonicalDedupeKey: normalizedDraft.canonicalDedupeKey,
    sourceId: input.rawRecord.sourceId,
    eventType: normalizedDraft.eventType,
    title: normalizedDraft.title,
    summary: normalizedDraft.summary,
    url: normalizedDraft.url,
    sourceCategory: input.config.category,
    sourceTrust: input.config.trustLevel,
    publishedAt: normalizedDraft.publishedAt,
    detectedAt: normalizedDraft.detectedAt,
    language: input.config.language,
    entitiesJson: normalizedDraft.entities
      ? JSON.stringify(normalizedDraft.entities)
      : input.classification.entities
        ? JSON.stringify(input.classification.entities)
        : undefined,
    symbolsJson: normalizedDraft.symbols
      ? JSON.stringify(normalizedDraft.symbols)
      : input.classification.symbols
        ? JSON.stringify(input.classification.symbols)
        : undefined,
    severityHint: normalizedDraft.severityHint,
    processingLabelsJson: processingLabels,
    timelineStatus: 'new',
    normalizerVersion: input.adapterParserVersion
  }
  input.items.set(itemId, {
    ...item,
    eventType: normalizedDraft.eventType,
    title: normalizedDraft.title,
    summary: normalizedDraft.summary,
    url: normalizedDraft.url,
    publishedAt: normalizedDraft.publishedAt,
    processingLabelsJson: processingLabels,
    timelineStatus: existingItem?.timelineStatus ?? 'new'
  })
  if (!existingItem) {
    input.newItemIds.push(itemId)
  }

  const clusterResult = resolveCluster({
    candidate: {
      sourceId: input.rawRecord.sourceId,
      sourceGroup: input.config.sourceGroup,
      clusterType: normalizedDraft.clusterType,
      clusterKey: normalizedDraft.clusterKey,
      title: normalizedDraft.title,
      publishedAt: normalizedDraft.publishedAt,
      detectedAt: normalizedDraft.detectedAt,
      entities: normalizedDraft.entities ?? [],
      itemId,
      trustLevel: input.config.trustLevel
    },
    existingClusters: [...input.clusters.values()],
    existingItems: [...input.items.values()]
  })
  input.clusters.set(clusterResult.cluster.clusterId, {
    ...clusterResult.cluster,
    primaryItemId: itemId
  })
  input.items.set(itemId, { ...input.items.get(itemId)!, clusterId: clusterResult.cluster.clusterId })
  return true
}

function persistMetricEventFromDraft(input: {
  itemId: string
  sourceId: string
  draftJson?: string
  metricEvents: MetricIntelligenceEvent[]
}): MetricIntelligenceEvent | undefined {
  if (!input.draftJson?.trim()) return undefined
  try {
    const draft = JSON.parse(input.draftJson) as MetricIntelligenceEventDraft
    const metricEventId = `metric-${input.itemId}-${draft.metricKey}`
    const existing = input.metricEvents.find((entry) => entry.metricEventId === metricEventId)
    if (existing) return existing

    const event: MetricIntelligenceEvent = {
      metricEventId,
      itemId: input.itemId,
      metricVersion: 'v1',
      ...draft,
      sourceId: draft.sourceId ?? input.sourceId
    }
    input.metricEvents.push(event)
    return event
  } catch {
    return undefined
  }
}

function collectAggregateScopes(
  signals: SentimentSignalInput[],
  preferredScopeKey?: string
): Array<{ scopeType: SentimentSignalInput['scopeType']; scopeKey: string }> {
  const scopes = new Map<string, { scopeType: SentimentSignalInput['scopeType']; scopeKey: string }>()
  for (const scope of DEFAULT_AGGREGATE_SCOPES) {
    scopes.set(`${scope.scopeType}:${scope.scopeKey}`, scope)
  }
  for (const signal of signals) {
    scopes.set(`${signal.scopeType}:${signal.scopeKey}`, {
      scopeType: signal.scopeType,
      scopeKey: signal.scopeKey
    })
  }
  if (preferredScopeKey) {
    return [...scopes.values()].filter((scope) => scope.scopeKey === preferredScopeKey || preferredScopeKey === 'global')
  }
  return [...scopes.values()]
}

function collectAggregateHorizons(
  signals: SentimentSignalInput[],
  preferredHorizon: SentimentSignalInput['horizon']
): SentimentSignalInput['horizon'][] {
  const horizons = new Set<SentimentSignalInput['horizon']>([preferredHorizon])
  for (const signal of signals) horizons.add(signal.horizon)
  return [...horizons]
}

function queueJob(jobs: string[], jobId: string): void {
  if (!jobs.includes(jobId)) jobs.push(jobId)
}

function buildFixtureRawRecords(
  sourceId: string,
  runId: string,
  fixtureText: string,
  parserVersion: string
) {
  if (sourceId === 'coindesk-rss') {
    return parseRssFeedToRawRecords({ config: { sourceId }, runId, xml: fixtureText })
  }

  if (
    sourceId === 'alternative-fear-greed' ||
    sourceId === 'coingecko-market' ||
    sourceId === 'defillama-tvl' ||
    sourceId === 'binance-spot-market' ||
    sourceId === 'binance-futures-positioning' ||
    sourceId === 'bls-economic-series' ||
    sourceId === 'bea-economic-series' ||
    sourceId === 'treasury-fiscal-data'
  ) {
    return [
      {
        sourceId,
        runId,
        payloadFormat: 'json' as const,
        payloadRefType: 'inline' as const,
        payloadBody: fixtureText,
        payloadHash: hashPayload(fixtureText),
        sourceDedupeKey: `fixture:${sourceId}:${hashPayload(fixtureText).slice(0, 16)}`,
        parserVersion: 'metric-rest-api-v1',
        payloadMetaJson: fixturePayloadMeta(sourceId, fixtureText)
      }
    ]
  }

  if (sourceId === 'fred-rates-liquidity') {
    return [
      {
        sourceId,
        runId,
        payloadFormat: 'json' as const,
        payloadRefType: 'inline' as const,
        payloadBody: fixtureText,
        payloadHash: hashPayload(fixtureText),
        sourceDedupeKey: `fixture:${sourceId}:${hashPayload(fixtureText).slice(0, 16)}`,
        parserVersion: 'metric-rest-api-v1',
        payloadMetaJson: JSON.stringify(inferFredFixtureMeta(fixtureText))
      }
    ]
  }

  if (isBinanceHtmlSource(sourceId)) {
    const articles = parseBinanceArticleListResponse(fixtureText)
    return binanceArticlesToRawRecords({
      config: {
        sourceId,
        language: 'en',
        adapterConfig: {}
      } as never,
      runId,
      articles
    })
  }

  // Replay stores what the live path would have stored: the same parsers the collectors call turn the
  // fixture (the real response bytes) into one raw record per announcement / release, so a replayed
  // OKX or GitHub window is read by exactly the parser that will read the live window.
  if (isOkxAnnouncementsSource(sourceId)) {
    return okxAnnouncementsToRawRecords({
      config: { sourceId, language: 'en', adapterConfig: {} } as never,
      runId,
      announcements: parseOkxAnnouncementsResponse(fixtureText)
    })
  }

  if (sourceId === 'github-releases') {
    return githubReleasesToRawRecords({
      config: { sourceId, language: 'en', adapterConfig: {} } as never,
      runId,
      releases: parseGithubReleasesResponse(fixtureText)
    })
  }

  return [
    {
      sourceId,
      runId,
      payloadFormat: 'json' as const,
      payloadRefType: 'inline' as const,
      payloadBody: fixtureText,
      payloadHash: hashPayload(fixtureText),
      sourceDedupeKey: `fixture:${sourceId}:${hashPayload(fixtureText).slice(0, 16)}`,
      parserVersion
    }
  ]
}

function fixturePayloadMeta(sourceId: string, fixtureText: string): string | undefined {
  if (sourceId === 'treasury-fiscal-data') {
    return JSON.stringify({ metricKey: 'US_TGA_BALANCE' })
  }
  if (sourceId === 'bea-economic-series') {
    const payload = JSON.parse(fixtureText) as { BEAAPI?: { Results?: { Data?: Array<{ TableName?: string }> } } }
    const table = payload.BEAAPI?.Results?.Data?.[0]?.TableName
    if (table === 'T10101') return JSON.stringify({ metricKey: 'US_GDP_REAL_QOQ_ANNUALIZED' })
    return JSON.stringify({ metricKey: 'US_PCE_HEADLINE_YOY' })
  }
  return undefined
}

function inferFredFixtureMeta(fixtureText: string): { seriesId: string; metricKey: string } {
  const payload = JSON.parse(fixtureText) as { observations?: Array<{ value?: string }> }
  const latest = Number(payload.observations?.[0]?.value ?? 0)
  if (latest > 1_000_000) {
    return { seriesId: 'WALCL', metricKey: 'FED_BALANCE_SHEET' }
  }
  if ((payload.observations ?? []).length >= 3 && Number(payload.observations?.[2]?.value) > Number(payload.observations?.[0]?.value)) {
    return { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD' }
  }
  return { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD' }
}
