import { hashPayload } from '@platform/jobs'

import type {
  IntelligenceTranslationRecord,
  IntelligenceTranslationSettings,
  IntelligenceTranslationSourceType,
  IntelligenceTranslationStatus,
  IntelligenceTranslationTargetLocale,
  TranslateIntelligenceItemsJobInput
} from '../schema/intelligenceTranslation'
import type { IntelligenceItem, IntelligenceItemRevision } from '../schema/intelligenceRecord'

export const INTELLIGENCE_TRANSLATION_PROMPT_VERSION = 'intelligence-translation-v1'

export function createDefaultTranslationSettings(
  appLanguage: 'zh-CN' | 'en-US'
): IntelligenceTranslationSettings {
  return {
    autoTranslateEnabled: appLanguage === 'zh-CN',
    targetLocale: 'follow-app',
    translateTitle: true,
    // Automatic translation is headline-only. Summaries and bodies are deliberate manual actions.
    translateSummary: false,
    translateEvidenceExcerpt: false,
    updatedAt: new Date().toISOString()
  }
}

export function resolveTargetLocale(
  settings: IntelligenceTranslationSettings,
  appLanguage: 'zh-CN' | 'en-US'
): IntelligenceTranslationTargetLocale {
  if (settings.targetLocale === 'follow-app') return appLanguage
  return settings.targetLocale
}

export function isChineseLanguage(language?: string): boolean {
  return Boolean(language?.toLowerCase().startsWith('zh'))
}

export function isEnglishLanguage(language?: string): boolean {
  return Boolean((language ?? 'en').toLowerCase().startsWith('en'))
}

/**
 * 自动翻译关闭时，只有读者显式触发的两种原因可以继续跑。
 *
 * 入口一致性：`normalizeRawRecords` 无条件把 `translateItems` 入队，所以门控必须在这里，
 * 不能只放在 `maybeEnqueueForNewItems` 里（设计 154 §7.6）。
 */
export function shouldTranslateForReason(
  settings: Pick<IntelligenceTranslationSettings, 'autoTranslateEnabled'>,
  reason: TranslateIntelligenceItemsJobInput['reason']
): boolean {
  if (settings.autoTranslateEnabled) return true
  return reason === 'manual-selection' || reason === 'retry-failed'
}

export function needsTranslation(
  sourceLanguage: string | undefined,
  targetLocale: IntelligenceTranslationTargetLocale
): boolean {
  if (targetLocale === 'zh-CN' && isChineseLanguage(sourceLanguage)) return false
  if (targetLocale === 'en-US' && isEnglishLanguage(sourceLanguage)) return false
  return true
}

export function computeTranslationSourceHash(input: {
  title?: string
  summary?: string
  body?: string
  revisionId?: string
}): string {
  return hashPayload(
    JSON.stringify({
      title: input.title ?? '',
      summary: input.summary ?? '',
      body: input.body ?? '',
      revisionId: input.revisionId ?? ''
    })
  )
}

export function resolveItemSourceLanguage(item: IntelligenceItem, fallbackLanguage?: string): string {
  return item.language ?? fallbackLanguage ?? 'en'
}

export function resolveEffectiveRevision(
  item: IntelligenceItem,
  revisions: IntelligenceItemRevision[]
): IntelligenceItemRevision | undefined {
  return [...revisions]
    .filter((revision) => revision.itemId === item.itemId)
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))[0]
}

export function buildItemTranslationFields(
  item: IntelligenceItem,
  revision: IntelligenceItemRevision | undefined,
  settings: IntelligenceTranslationSettings
): { title?: string; summary?: string; body?: string; revisionId?: string } {
  return {
    title: settings.translateTitle ? revision?.title ?? item.title : undefined,
    summary: settings.translateSummary ? revision?.summary ?? item.summary : undefined,
    revisionId: revision?.revisionId
  }
}

export function findActiveTranslationRecord(
  records: IntelligenceTranslationRecord[],
  input: {
    sourceType: IntelligenceTranslationSourceType
    sourceId: string
    sourceHash: string
    targetLocale: IntelligenceTranslationTargetLocale
  }
): IntelligenceTranslationRecord | undefined {
  return records
    .filter(
      (record) =>
        record.sourceType === input.sourceType &&
        record.sourceId === input.sourceId &&
        record.sourceHash === input.sourceHash &&
        record.targetLocale === input.targetLocale &&
        record.status !== 'stale'
    )
    .sort((left, right) => (right.translatedAt ?? '').localeCompare(left.translatedAt ?? ''))[0]
}

export function markStaleTranslationsForSource(
  records: IntelligenceTranslationRecord[],
  input: {
    sourceType: IntelligenceTranslationSourceType
    sourceId: string
    targetLocale: IntelligenceTranslationTargetLocale
    nextSourceHash: string
  }
): IntelligenceTranslationRecord[] {
  return records.map((record) => {
    if (
      record.sourceType !== input.sourceType ||
      record.sourceId !== input.sourceId ||
      record.targetLocale !== input.targetLocale ||
      record.sourceHash === input.nextSourceHash ||
      record.status === 'stale'
    ) {
      return record
    }
    return { ...record, status: 'stale' as IntelligenceTranslationStatus }
  })
}

export function createSafeEvidenceExcerpt(text: string | undefined, maxLength = 1200): string | undefined {
  if (!text?.trim()) return undefined
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

export function createTranslationId(): string {
  return `translation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createTranslationGroupId(): string {
  return `translation-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 把一次入队按条目的来源拆成一批一批，每批带自己的 `sourceId`。
 *
 * 为什么非拆不可：定义 id 要稳定到来源级（`translateItems.<sourceId>`），而一个批次可能
 * 跨来源——一次重建（normalize 不带来源）产出的新条目就横跨所有来源。不拆，id 只能退回
 * `global`，读者按来源筛时这些批照样看不见。
 *
 * 只拆「入队时就知道每条属于哪个来源」的批：只带筛选条件的批，候选要等执行时才选，
 * 那时拆批就得猜；猜错的代价是同一批翻译被拆成互相看不见的几份。算不出来源的条目留在
 * 一个没有 `sourceId` 的批里，跑完仍然能翻到，只是按来源筛不到。
 */
export function splitTranslationBatchBySource(
  input: TranslateIntelligenceItemsJobInput,
  items: readonly Pick<IntelligenceItem, 'itemId' | 'sourceId'>[]
): TranslateIntelligenceItemsJobInput[] {
  if (!input.itemIds?.length) return [input]
  const sourceByItem = new Map(items.map((item) => [item.itemId, item.sourceId]))
  const itemIdsBySource = new Map<string, string[]>()
  const unassigned: string[] = []
  for (const itemId of input.itemIds) {
    const sourceId = sourceByItem.get(itemId)
    if (!sourceId) {
      unassigned.push(itemId)
      continue
    }
    const bucket = itemIdsBySource.get(sourceId) ?? []
    bucket.push(itemId)
    itemIdsBySource.set(sourceId, bucket)
  }
  const batches: TranslateIntelligenceItemsJobInput[] = [...itemIdsBySource].map(([sourceId, itemIds]) => ({
    ...input,
    itemIds,
    sourceId
  }))
  if (unassigned.length > 0) batches.push({ ...input, itemIds: unassigned })
  return batches.length > 0 ? batches : [input]
}
