import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { getIntelligenceModule, INTELLIGENCE_PRODUCT_ID } from '../intelligenceModule'
import type { IntelligenceTranslationSettings } from '../schema/intelligenceTranslation'
import type { TranslateIntelligenceItemsJobInput } from '../schema/intelligenceTranslation'

export function registerIntelligenceTranslationIpc(register: ProductIpcRegistrar, jobRuntime: JobRuntime): void {
  const invoke = (method: string, payload?: unknown) => {
    const service = getIntelligenceModule(jobRuntime).translationService
    switch (method) {
      case 'getSettings':
        return service.getSettings()
      case 'saveSettings':
        return service.saveSettings((payload ?? {}) as Partial<IntelligenceTranslationSettings>)
      case 'queueMissing':
        return service.queueMissing((payload ?? {}) as TranslateIntelligenceItemsJobInput)
      case 'retryFailed':
        return service.retryFailed((payload ?? {}) as TranslateIntelligenceItemsJobInput)
      case 'getStatus':
        return service.getStatus((payload ?? {}) as { itemIds?: string[]; clusterIds?: string[] })
      case 'getModuleStatus':
        return service.getModuleStatus()
      default:
        throw new Error(`Unknown intelligenceTranslation IPC method "${method}".`)
    }
  }

  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.getSettings', async () => invoke('getSettings'))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.saveSettings', async (payload) => invoke('saveSettings', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.queueMissing', async (payload) => invoke('queueMissing', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.retryFailed', async (payload) => invoke('retryFailed', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.getStatus', async (payload) => invoke('getStatus', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceTranslation.getModuleStatus', async () => invoke('getModuleStatus'))
}
