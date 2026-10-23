import type {
  IntelligenceTranslationSettings,
  SafeIntelligenceTranslationSettings,
  SafeTranslationJobSummary,
  SafeTranslationModuleStatus,
  SafeTranslationStatus,
  TranslateIntelligenceItemsJobInput
} from '../../../service/intelligence/schema/intelligenceTranslation'

const PRODUCT_ID = 'market-intelligence'

export class IntelligenceTranslationClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntelligenceTranslationClientError'
  }
}

function invoke<T>(method: string, payload?: unknown): Promise<T> {
  if (!window.platform?.products?.invoke) {
    throw new IntelligenceTranslationClientError('Product IPC bridge is unavailable.')
  }
  return window.platform.products.invoke(PRODUCT_ID, method, payload).catch((error: unknown) => {
    throw new IntelligenceTranslationClientError(
      error instanceof Error ? error.message : 'Intelligence translation request failed.'
    )
  }) as Promise<T>
}

export const intelligenceTranslationClient = {
  getSettings() {
    return invoke<SafeIntelligenceTranslationSettings>('intelligenceTranslation.getSettings')
  },
  saveSettings(patch: Partial<IntelligenceTranslationSettings>) {
    return invoke<SafeIntelligenceTranslationSettings>('intelligenceTranslation.saveSettings', patch)
  },
  queueMissing(input: TranslateIntelligenceItemsJobInput) {
    return invoke<SafeTranslationJobSummary>('intelligenceTranslation.queueMissing', input)
  },
  retryFailed(input: TranslateIntelligenceItemsJobInput) {
    return invoke<SafeTranslationJobSummary>('intelligenceTranslation.retryFailed', input)
  },
  getStatus(input?: { itemIds?: string[]; clusterIds?: string[] }) {
    return invoke<Record<string, SafeTranslationStatus>>('intelligenceTranslation.getStatus', input ?? {})
  },
  getModuleStatus() {
    return invoke<SafeTranslationModuleStatus>('intelligenceTranslation.getModuleStatus')
  }
}
