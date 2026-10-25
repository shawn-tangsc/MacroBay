import type { JobRuntime } from '@platform/jobs'
import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { IntelligencePipeline } from './intelligencePipeline'
import type { IntelligenceTranslationStorage } from '../store/intelligenceTranslationStorage'
import type {
  IntelligenceItem,
  IntelligenceItemRevision
} from '../schema/intelligenceRecord'
import type {
  IntelligenceTranslationRecord,
  IntelligenceTranslationSettings,
  IntelligenceTranslationTargetLocale,
  SafeIntelligenceTranslationSettings,
  SafeTranslationDisplayText,
  SafeTranslationJobSummary,
  SafeTranslationModuleStatus,
  SafeTranslationStatus,
  TranslateIntelligenceItemsJobInput
} from '../schema/intelligenceTranslation'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import {
  buildItemTranslationFields,
  computeTranslationSourceHash,
  createDefaultTranslationSettings,
  createSafeEvidenceExcerpt,
  createTranslationId,
  findActiveTranslationRecord,
  INTELLIGENCE_TRANSLATION_PROMPT_VERSION,
  markStaleTranslationsForSource,
  needsTranslation,
  resolveEffectiveRevision,
  resolveItemSourceLanguage,
  resolveTargetLocale,
  shouldTranslateForReason
} from './intelligenceTranslationHelpers'
import { sanitizeIntelligenceText } from './intelligenceItemLabels'
import {
  buildTranslationSystemPrompt,
  buildTranslationUserPrompt,
  parseTranslationModelOutput
} from './intelligenceTranslationPrompt'
import { resolveTranslationModel } from './intelligenceTranslationModel'
import { INTELLIGENCE_TRANSLATE_ITEMS_JOB } from '../jobs/intelligenceJobIds'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceTranslationService = ReturnType<typeof createIntelligenceTranslationService>

export function createIntelligenceTranslationService(deps: {
  storage: IntelligenceTranslationStorage
  pipeline: IntelligencePipeline
  jobRuntime: JobRuntime
  structuredModelInvocation: StructuredModelInvocationService
  getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影（未注入 = 不跟随默认，保持旧行为）。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  /** 默认模型可用性判据与翻译请求共用同一份供应商状态。 */
  getProviderState?: () => Promise<ProviderState>
}) {
  let lastJobSummary: string | undefined
  let lastJobAt: string | undefined

  async function readModelDefaults(): Promise<Pick<ModelDefaultsSettings, 'translationModelId'> | undefined> {
    if (!deps.getModelDefaults) return undefined
    try {
      return await deps.getModelDefaults()
    } catch {
      return undefined
    }
  }

  async function readProviders(): Promise<ProviderState['providers']> {
    if (!deps.getProviderState) return []
    try {
      return (await deps.getProviderState()).providers
    } catch {
      return []
    }
  }

  async function readRecords(): Promise<IntelligenceTranslationRecord[]> {
    return deps.storage.readRecords()
  }

  async function writeRecords(records: IntelligenceTranslationRecord[]): Promise<void> {
    await deps.storage.writeRecords(records)
  }

  async function loadDisplayResolutionContext(): Promise<{
    settings: IntelligenceTranslationSettings
    targetLocale: IntelligenceTranslationTargetLocale
    records: IntelligenceTranslationRecord[]
    revisions: IntelligenceItemRevision[]
  }> {
    const [settings, appLanguage, records] = await Promise.all([
      deps.storage.readSettings(),
      deps.getAppLanguage(),
      readRecords()
    ])
    return {
      settings,
      targetLocale: resolveTargetLocale(settings, appLanguage),
      records,
      revisions: deps.pipeline.listRevisions()
    }
  }

  function buildCompactionPlan(
    records: IntelligenceTranslationRecord[],
    retentionMode: 'compact' | 'balanced' | 'extended'
  ): {
    next: IntelligenceTranslationRecord[]
    removedCount: number
  } {
    const keepDays = retentionMode === 'compact' ? 7 : retentionMode === 'extended' ? 90 : 30
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
    const hotItemIds = new Set(deps.pipeline.listItems().map((item) => item.itemId))

    const next = records.filter((record) => {
      const timestamp = record.translatedAt ? new Date(record.translatedAt).getTime() : 0
      if (record.status === 'stale' || record.status === 'failed') {
        return timestamp >= cutoff
      }
      if (record.status === 'not-required') return false
      if (record.status === 'translated' && !hotItemIds.has(record.sourceId)) {
        return timestamp >= cutoff
      }
      return true
    })

    return {
      next,
      removedCount: records.length - next.length
    }
  }

  return {
    async listRecords(): Promise<IntelligenceTranslationRecord[]> {
      return readRecords()
    },

    async replaceRecords(records: IntelligenceTranslationRecord[]): Promise<void> {
      await writeRecords(records)
    },

    async getSettings(): Promise<SafeIntelligenceTranslationSettings> {
      const [settings, appLanguage, modelDefaults] = await Promise.all([
        deps.storage.readSettings(),
        deps.getAppLanguage(),
        readModelDefaults()
      ])
      const resolvedTargetLocale = resolveTargetLocale(settings, appLanguage)
      return {
        ...settings,
        resolvedTargetLocale,
        defaultModelId: modelDefaults?.translationModelId?.trim() ?? ''
      }
    },

    async saveSettings(patch: Partial<IntelligenceTranslationSettings>): Promise<SafeIntelligenceTranslationSettings> {
      const current = await deps.storage.readSettings()
      const accepted = pickSettingsPatch(patch)
      const next: IntelligenceTranslationSettings = {
        ...current,
        ...accepted,
        updatedAt: new Date().toISOString()
      }
      await deps.storage.writeSettings(next)
      if (
        accepted.autoTranslateEnabled !== undefined ||
        accepted.targetLocale !== undefined ||
        accepted.translateTitle !== undefined ||
        accepted.translateSummary !== undefined ||
        accepted.translateEvidenceExcerpt !== undefined
      ) {
        await this.queueMissing({ reason: 'settings-change' })
      }
      return this.getSettings()
    },

    async getStatus(input?: { itemIds?: string[]; clusterIds?: string[] }): Promise<Record<string, SafeTranslationStatus>> {
      const [settings, appLanguage, records] = await Promise.all([
        deps.storage.readSettings(),
        deps.getAppLanguage(),
        readRecords()
      ])
      const targetLocale = resolveTargetLocale(settings, appLanguage)
      const itemIds = new Set(input?.itemIds ?? [])
      for (const clusterId of input?.clusterIds ?? []) {
        const cluster = deps.pipeline.listClusters().find((entry) => entry.clusterId === clusterId)
        if (cluster) itemIds.add(cluster.primaryItemId)
      }

      const statuses: Record<string, SafeTranslationStatus> = {}
      for (const item of deps.pipeline.listItems()) {
        if (itemIds.size > 0 && !itemIds.has(item.itemId)) continue
        const status = await this.resolveItemStatus(item.itemId, targetLocale, settings, records)
        statuses[item.itemId] = status
      }
      return statuses
    },

    async getModuleStatus(): Promise<SafeTranslationModuleStatus> {
      const records = await readRecords()
      const sourceByItem = new Map(deps.pipeline.listItems().map((item) => [item.itemId, item.sourceId]))
      const bySource: Record<string, { pendingCount: number; failedCount: number; translatedCount: number }> = {}
      for (const record of records) {
        const sourceId = sourceByItem.get(record.sourceId)
        if (!sourceId) continue
        const counts = bySource[sourceId] ?? { pendingCount: 0, failedCount: 0, translatedCount: 0 }
        if (record.status === 'pending') counts.pendingCount += 1
        else if (record.status === 'failed') counts.failedCount += 1
        else if (record.status === 'translated') counts.translatedCount += 1
        bySource[sourceId] = counts
      }
      return {
        pendingCount: records.filter((record) => record.status === 'pending').length,
        failedCount: records.filter((record) => record.status === 'failed').length,
        translatedCount: records.filter((record) => record.status === 'translated').length,
        lastJobAt,
        lastJobSummary,
        bySource
      }
    },

    async queueMissing(input: TranslateIntelligenceItemsJobInput): Promise<SafeTranslationJobSummary> {
      const queuedCount = await enqueueTranslationJob(deps.jobRuntime, input)
      lastJobAt = new Date().toISOString()
      lastJobSummary = `Queued ${queuedCount} translation work item(s).`
      return {
        queuedAt: lastJobAt,
        queuedCount,
        reason: input.reason
      }
    },

    async retryFailed(input: TranslateIntelligenceItemsJobInput): Promise<SafeTranslationJobSummary> {
      return this.queueMissing({ ...input, reason: 'retry-failed' })
    },

    async maybeEnqueueForNewItems(itemIds: string[]): Promise<void> {
      const settings = await deps.storage.readSettings()
      if (!settings.autoTranslateEnabled || itemIds.length === 0) return
      await enqueueTranslationJob(deps.jobRuntime, {
        itemIds,
        reason: 'new-item'
      })
    },

    async resolveDisplayText(input: {
      itemId: string
      textMode?: 'translated' | 'original'
    }): Promise<SafeTranslationDisplayText | undefined> {
      const item = deps.pipeline.listItems().find((entry) => entry.itemId === input.itemId)
      if (!item) return undefined
      const context = await loadDisplayResolutionContext()
      return resolveDisplayTextForItem(item, input.textMode, context)
    },

    async resolveDisplayTexts(input: {
      itemIds: string[]
      textMode?: 'translated' | 'original'
    }): Promise<Record<string, SafeTranslationDisplayText | undefined>> {
      const itemIds = [...new Set(input.itemIds)]
      if (itemIds.length === 0) return {}

      const itemsById = new Map(deps.pipeline.listItems().map((item) => [item.itemId, item]))
      const context = await loadDisplayResolutionContext()
      const resolvedEntries = itemIds.map((itemId) => {
        const item = itemsById.get(itemId)
        return [
          itemId,
          item ? resolveDisplayTextForItem(item, input.textMode, context) : undefined
        ] as const
      })
      return Object.fromEntries(resolvedEntries)
    },

    async resolveItemStatus(
      itemId: string,
      targetLocale: IntelligenceTranslationTargetLocale,
      settings: IntelligenceTranslationSettings,
      records: IntelligenceTranslationRecord[]
    ): Promise<SafeTranslationStatus> {
      const item = deps.pipeline.listItems().find((entry) => entry.itemId === itemId)
      if (!item) {
        return {
          sourceType: 'item',
          sourceId: itemId,
          targetLocale,
          status: 'pending'
        }
      }

      const definition = getIntelligenceSourceDefinition(item.sourceId)
      const sourceLanguage = resolveItemSourceLanguage(item, definition?.language)
      if (!needsTranslation(sourceLanguage, targetLocale)) {
        return {
          sourceType: 'item',
          sourceId: itemId,
          targetLocale,
          status: 'not-required'
        }
      }

      const revision = resolveEffectiveRevision(item, deps.pipeline.listRevisions())
      const fields = buildItemTranslationFields(item, revision, settings)
      const sourceHash = computeTranslationSourceHash(fields)
      const active = findActiveTranslationRecord(records, {
        sourceType: 'item',
        sourceId: itemId,
        sourceHash,
        targetLocale
      })

      return {
        sourceType: 'item',
        sourceId: itemId,
        targetLocale,
        status: active?.status ?? 'pending',
        translatedAt: active?.translatedAt,
        errorCode: active?.errorCode
      }
    },

    async translateItems(input: TranslateIntelligenceItemsJobInput): Promise<{ processed: number; failed: number }> {
      const [settings, appLanguage, modelDefaults, providers] = await Promise.all([
        deps.storage.readSettings(),
        deps.getAppLanguage(),
        readModelDefaults(),
        readProviders()
      ])
      // 自动翻译关闭时，pipeline 仍会把 new-item 入队；在这里停住，而不是让每个新条目都调用模型。
      if (!shouldTranslateForReason(settings, input.reason)) {
        return { processed: 0, failed: 0 }
      }
      // 每次任务开始时解析：显式绑定优先，其次模型服务的默认翻译模型，最后沿用供应商默认聊天模型。
      const model = resolveTranslationModel({ settings, modelDefaults, providers })
      const targetLocale = input.targetLocale ?? resolveTargetLocale(settings, appLanguage)
      let records = await readRecords()
      const candidates = selectTranslationCandidates(deps.pipeline, input, settings, targetLocale, records)
      let processed = 0
      let failed = 0

      for (const candidate of candidates) {
        if (candidate.kind === 'skip-not-required') {
          records = upsertRecord(records, {
            translationId: createTranslationId(),
            sourceType: 'item',
            sourceId: candidate.itemId,
            sourceHash: candidate.sourceHash,
            sourceLanguage: candidate.sourceLanguage,
            targetLocale,
            status: 'not-required',
            promptVersion: INTELLIGENCE_TRANSLATION_PROMPT_VERSION
          })
          processed += 1
          continue
        }

        if (candidate.kind === 'reuse') {
          processed += 1
          continue
        }

        records = markStaleTranslationsForSource(records, {
          sourceType: 'item',
          sourceId: candidate.itemId,
          targetLocale,
          nextSourceHash: candidate.sourceHash
        })

        const pendingRecord: IntelligenceTranslationRecord = {
          translationId: createTranslationId(),
          sourceType: 'item',
          sourceId: candidate.itemId,
          sourceHash: candidate.sourceHash,
          sourceLanguage: candidate.sourceLanguage,
          targetLocale,
          status: 'pending',
          promptVersion: INTELLIGENCE_TRANSLATION_PROMPT_VERSION
        }
        records = upsertRecord(records, pendingRecord)
        await writeRecords(records)

        const modelResult = await deps.structuredModelInvocation.invoke({
          taskId: `market-intelligence.translation:${candidate.itemId}`,
          providerId: model.providerId,
          modelId: model.modelId,
          messages: [
            { role: 'system', content: buildTranslationSystemPrompt() },
            {
              role: 'user',
              content: buildTranslationUserPrompt({
                sourceLanguage: candidate.sourceLanguage,
                title: candidate.title,
                summary: createSafeEvidenceExcerpt(candidate.summary),
                body: createSafeEvidenceExcerpt(candidate.body)
              })
            }
          ],
          parse: parseTranslationModelOutput
        })

        if (!modelResult.ok) {
          failed += 1
          records = upsertRecord(records, {
            ...pendingRecord,
            status: 'failed',
            errorCode: modelResult.errorCode
          })
          await writeRecords(records)
          continue
        }

        records = upsertRecord(records, {
          ...pendingRecord,
          status: 'translated',
          providerId: modelResult.providerId,
          modelId: modelResult.modelId,
          titleTranslated: modelResult.output.title,
          summaryTranslated: modelResult.output.summary,
          bodyTranslated: modelResult.output.body,
          translatedAt: new Date().toISOString()
        })
        processed += 1
      }

      await writeRecords(records)
      return { processed, failed }
    },

    async compactDerivedRecords(input: { retentionMode: 'compact' | 'balanced' | 'extended' }) {
      const records = await readRecords()
      const { next, removedCount } = buildCompactionPlan(records, input.retentionMode)
      await writeRecords(next)
      return { removedCount }
    },

    async previewCompaction(input: { retentionMode: 'compact' | 'balanced' | 'extended' }) {
      const records = await readRecords()
      return buildCompactionPlan(records, input.retentionMode)
    }
  }
}

function resolveDisplayTextForItem(
  item: IntelligenceItem,
  textMode: 'translated' | 'original' | undefined,
  context: {
    settings: IntelligenceTranslationSettings
    targetLocale: IntelligenceTranslationTargetLocale
    records: IntelligenceTranslationRecord[]
    revisions: IntelligenceItemRevision[]
  }
): SafeTranslationDisplayText {
  const definition = getIntelligenceSourceDefinition(item.sourceId)
  const sourceLanguage = resolveItemSourceLanguage(item, definition?.language)
  const revision = resolveEffectiveRevision(item, context.revisions)
  const fields = buildItemTranslationFields(item, revision, context.settings)
  const sourceHash = computeTranslationSourceHash(fields)
  const originalTitle = sanitizeIntelligenceText(revision?.title ?? item.title)
  const originalSummary = sanitizeIntelligenceText(revision?.summary ?? item.summary)

  if (!needsTranslation(sourceLanguage, context.targetLocale)) {
    return {
      title: originalTitle,
      summary: originalSummary,
      originalTitle,
      originalSummary,
      status: 'not-required'
    }
  }

  const active = findActiveTranslationRecord(context.records, {
    sourceType: 'item',
    sourceId: item.itemId,
    sourceHash,
    targetLocale: context.targetLocale
  })

  const useTranslated = textMode !== 'original'
  const translatedTitle = active?.titleTranslated
  const translatedSummary = active?.summaryTranslated

  return {
    title: useTranslated && active?.status === 'translated' && translatedTitle ? translatedTitle : originalTitle,
    summary: useTranslated && active?.status === 'translated' && translatedSummary ? translatedSummary : originalSummary,
    originalTitle,
    originalSummary,
    status: active?.status ?? 'pending',
    translatedAt: active?.translatedAt,
    errorCode: active?.errorCode
  }
}

function upsertRecord(
  records: IntelligenceTranslationRecord[],
  record: IntelligenceTranslationRecord
): IntelligenceTranslationRecord[] {
  const index = records.findIndex(
    (entry) =>
      entry.sourceType === record.sourceType &&
      entry.sourceId === record.sourceId &&
      entry.sourceHash === record.sourceHash &&
      entry.targetLocale === record.targetLocale &&
      entry.status !== 'stale'
  )
  if (index === -1) return [...records, record]
  const next = [...records]
  next[index] = record
  return next
}

async function enqueueTranslationJob(
  jobRuntime: JobRuntime,
  input: TranslateIntelligenceItemsJobInput
): Promise<number> {
  const itemCount = input.itemIds?.length ?? input.clusterIds?.length ?? input.translationIds?.length ?? 1
  await jobRuntime.enqueueDefinition({
    id: `${INTELLIGENCE_TRANSLATE_ITEMS_JOB}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    owner: 'product',
    productId: PRODUCT_ID,
    handlerId: INTELLIGENCE_TRANSLATE_ITEMS_JOB,
    title: 'Translate intelligence items',
    trigger: { kind: 'manual' },
    payload: input
  })
  return itemCount
}

type TranslationCandidate =
  | {
      kind: 'translate'
      itemId: string
      sourceHash: string
      sourceLanguage: string
      title: string
      summary?: string
      body?: string
    }
  | { kind: 'reuse'; itemId: string; sourceHash: string; sourceLanguage: string }
  | { kind: 'skip-not-required'; itemId: string; sourceHash: string; sourceLanguage: string }

function selectTranslationCandidates(
  pipeline: IntelligencePipeline,
  input: TranslateIntelligenceItemsJobInput,
  settings: IntelligenceTranslationSettings,
  targetLocale: IntelligenceTranslationTargetLocale,
  records: IntelligenceTranslationRecord[]
): TranslationCandidate[] {
  const itemIds = resolveRequestedItemIds(pipeline, input, records)
  const candidates: TranslationCandidate[] = []

  for (const itemId of itemIds) {
    const item = pipeline.listItems().find((entry) => entry.itemId === itemId)
    if (!item) continue

    const definition = getIntelligenceSourceDefinition(item.sourceId)
    const sourceLanguage = resolveItemSourceLanguage(item, definition?.language)
    const revision = resolveEffectiveRevision(item, pipeline.listRevisions())
    const fields = buildItemTranslationFields(item, revision, settings)
    const sourceHash = computeTranslationSourceHash(fields)

    if (!needsTranslation(sourceLanguage, targetLocale)) {
      candidates.push({ kind: 'skip-not-required', itemId, sourceHash, sourceLanguage })
      continue
    }

    const active = findActiveTranslationRecord(records, {
      sourceType: 'item',
      sourceId: itemId,
      sourceHash,
      targetLocale
    })

    if (input.reason === 'retry-failed') {
      if (input.translationIds?.length && active && !input.translationIds.includes(active.translationId)) {
        continue
      }
      if (active?.status === 'translated') {
        candidates.push({ kind: 'reuse', itemId, sourceHash, sourceLanguage })
        continue
      }
    } else if (active?.status === 'translated') {
      candidates.push({ kind: 'reuse', itemId, sourceHash, sourceLanguage })
      continue
    }

    candidates.push({
      kind: 'translate',
      itemId,
      sourceHash,
      sourceLanguage,
      title: sanitizeIntelligenceText(revision?.title ?? item.title),
      summary: sanitizeIntelligenceText(revision?.summary ?? item.summary),
      body: createSafeEvidenceExcerpt(sanitizeIntelligenceText(revision?.summary ?? item.summary))
    })
  }

  return candidates
}

function resolveRequestedItemIds(
  pipeline: IntelligencePipeline,
  input: TranslateIntelligenceItemsJobInput,
  records: IntelligenceTranslationRecord[] = []
): string[] {
  if (input.translationIds?.length) {
    const ids = new Set<string>()
    for (const translationId of input.translationIds) {
      const record = records.find((entry) => entry.translationId === translationId)
      if (record?.sourceType === 'item') ids.add(record.sourceId)
    }
    return [...ids]
  }

  const ids = new Set<string>(input.itemIds ?? [])
  for (const clusterId of input.clusterIds ?? []) {
    const cluster = pipeline.listClusters().find((entry) => entry.clusterId === clusterId)
    if (cluster) ids.add(cluster.primaryItemId)
  }

  if (ids.size === 0) {
    return pipeline.listItems().slice(0, input.filters?.limit ?? 50).map((item) => item.itemId)
  }

  return [...ids]
}

/**
 * IPC patch 只接受用户可写字段：`defaultModelId` 是派生投影，`updatedAt` 由服务写入，
 * 任何未知键都不能落进翻译设置文件。
 */
function pickSettingsPatch(
  patch: Partial<IntelligenceTranslationSettings>
): Partial<IntelligenceTranslationSettings> {
  const next: Partial<IntelligenceTranslationSettings> = {}
  if (typeof patch.autoTranslateEnabled === 'boolean') next.autoTranslateEnabled = patch.autoTranslateEnabled
  if (patch.targetLocale === 'follow-app' || patch.targetLocale === 'zh-CN' || patch.targetLocale === 'en-US') {
    next.targetLocale = patch.targetLocale
  }
  if ('providerId' in patch) next.providerId = normalizeModelPart(patch.providerId)
  if ('modelId' in patch) next.modelId = normalizeModelPart(patch.modelId)
  if (typeof patch.translateTitle === 'boolean') next.translateTitle = patch.translateTitle
  if (typeof patch.translateSummary === 'boolean') next.translateSummary = patch.translateSummary
  if (typeof patch.translateEvidenceExcerpt === 'boolean') {
    next.translateEvidenceExcerpt = patch.translateEvidenceExcerpt
  }
  return next
}

function normalizeModelPart(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

export { createDefaultTranslationSettings }
