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
