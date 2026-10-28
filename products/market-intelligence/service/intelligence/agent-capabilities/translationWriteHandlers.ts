import { getIntelligenceModule } from '../intelligenceModule'
import type {
  IntelligenceTranslationSettings,
  TranslateIntelligenceItemsJobInput
} from '../schema/intelligenceTranslation'
import type { ToolCallContext } from './capabilityTypes'
import type { WriteHandlerDeps } from './writeAudit'
import { runAuditedWrite } from './writeAudit'
import { readTranslationSnapshot } from './writeState'

const TRANSLATION_CAPABILITY = { id: 'configure_translation', domain: 'translation' } as const

type TranslationAction = 'save-settings' | 'queue-missing' | 'retry-failed'

type TranslationFilters = {
  timeRange?: '24h' | '7d' | '30d' | 'all'
  sourceGroup?: string
  scope?: string
  symbol?: string
  limit?: number
}

type TranslationInput = {
  action: TranslationAction
  autoTranslateEnabled?: boolean
  targetLocale?: 'follow-app' | 'zh-CN' | 'en-US'
  providerId?: string
  modelId?: string
  translateTitle?: boolean
  translateSummary?: boolean
  translateEvidenceExcerpt?: boolean
  itemIds?: string[]
  clusterIds?: string[]
  filters?: TranslationFilters
}

export async function handleConfigureTranslation(
  input: unknown,
  deps: WriteHandlerDeps,
  context: ToolCallContext
): Promise<unknown> {
  const value = input as TranslationInput
  const translationService = getIntelligenceModule(deps.jobRuntime).translationService

  if (value.action === 'save-settings') {
    const patch = settingsPatch(value)
    return runAuditedWrite({
      deps,
      context,
      capability: TRANSLATION_CAPABILITY,
      action: value.action,
      read: () => readTranslationSnapshot(deps),
      execute: async () => {
        await translationService.saveSettings(patch)
        return { state: 'saved' }
      }
    })
  }

  const selection = itemSelection(value)
  return runAuditedWrite({
    deps,
    context,
    capability: TRANSLATION_CAPABILITY,
    action: value.action,
    // Queueing and retrying spend work; they do not edit the translation settings.
    changesConfiguration: false,
    read: () => readTranslationSnapshot(deps),
    execute: async () => {
      if (value.action === 'queue-missing') {
        // A manual selection is what the reader asked for; settings changes and new items have
        // their own reasons and must not be conflated with this one.
        const result = await translationService.queueMissing({
          ...selection,
          reason: 'manual-selection'
        })
        return { state: 'queued', ...result }
      }
      // `retryFailed` stamps `reason: 'retry-failed'` itself; the caller selects items only.
      const result = await translationService.retryFailed(
        selection as TranslateIntelligenceItemsJobInput
      )
      return { state: 'queued', ...result }
    }
  })
}

function settingsPatch(
  value: TranslationInput
): Partial<IntelligenceTranslationSettings> {
  const patch: Partial<IntelligenceTranslationSettings> = {}
  if (typeof value.autoTranslateEnabled === 'boolean') patch.autoTranslateEnabled = value.autoTranslateEnabled
  if (value.targetLocale !== undefined) patch.targetLocale = value.targetLocale
  if (value.providerId !== undefined) patch.providerId = value.providerId
  if (value.modelId !== undefined) patch.modelId = value.modelId
  if (typeof value.translateTitle === 'boolean') patch.translateTitle = value.translateTitle
  if (typeof value.translateSummary === 'boolean') patch.translateSummary = value.translateSummary
  if (typeof value.translateEvidenceExcerpt === 'boolean') {
    patch.translateEvidenceExcerpt = value.translateEvidenceExcerpt
  }
  return patch
}

function itemSelection(value: TranslationInput): {
  itemIds?: string[]
  clusterIds?: string[]
  filters?: TranslationFilters
  targetLocale?: 'zh-CN' | 'en-US'
} {
  return {
    ...(value.itemIds ? { itemIds: [...value.itemIds] } : {}),
    ...(value.clusterIds ? { clusterIds: [...value.clusterIds] } : {}),
    ...(value.filters ? { filters: { ...value.filters } } : {}),
    ...(value.targetLocale && value.targetLocale !== 'follow-app'
      ? { targetLocale: value.targetLocale }
      : {})
  }
}
