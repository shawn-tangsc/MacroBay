import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { getIntelligenceModule, INTELLIGENCE_PRODUCT_ID } from '../intelligenceModule'

export function registerIntelligenceSourcesIpc(register: ProductIpcRegistrar, jobRuntime: JobRuntime): void {
  const invoke = (method: string, payload?: unknown) => {
    const service = getIntelligenceModule(jobRuntime).sourcesService
    switch (method) {
      case 'listDefinitions':
        return service.listDefinitions()
      case 'listProfiles':
        return service.listProfiles()
      case 'getPageState':
        return service.getPageState((payload ?? {}) as { sourceId?: string })
      case 'saveProfile':
        return service.saveProfile((payload ?? {}) as Parameters<typeof service.saveProfile>[0])
      case 'setEnabled':
        return service.setEnabled((payload ?? {}) as { sourceId: string; enabled: boolean })
      case 'testCredentials':
        return service.testCredentials((payload ?? {}) as { sourceId: string; credentialDraft?: string })
      case 'runNow':
        return service.runNow((payload ?? {}) as { sourceId: string })
      case 'replayWindow':
        return service.replayWindow((payload ?? {}) as { sourceId: string; from?: string; to?: string })
      case 'getHealth':
        return service.getHealth((payload ?? {}) as { sourceId: string })
      case 'getSettingsView':
        return service.getSettingsView()
      case 'revealCredential':
        return service.revealCredential((payload ?? {}) as { sourceId: string })
      case 'setCalendarEnabled':
        return service.setCalendarEnabled((payload ?? {}) as { sourceId: string; enabled: boolean })
      case 'getAgentView':
        return service.getAgentView((payload ?? {}) as { agentId: string })
      case 'getPanelView':
        return service.getPanelView((payload ?? {}) as { panelId: string })
      case 'testConnection':
        return service.testConnection((payload ?? {}) as { sourceId: string })
      case 'getFocusSettings':
        return service.getFocusSettings()
      case 'saveFocusSettings':
        return service.saveFocusSettings((payload ?? {}) as Parameters<typeof service.saveFocusSettings>[0])
      default:
        throw new Error(`Unknown intelligenceSources IPC method "${method}".`)
    }
  }

  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.listDefinitions', async () => invoke('listDefinitions'))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.listProfiles', async () => invoke('listProfiles'))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getSettingsView', async () => invoke('getSettingsView'))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.revealCredential', async (payload) => invoke('revealCredential', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.setCalendarEnabled', async (payload) => invoke('setCalendarEnabled', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getAgentView', async (payload) => invoke('getAgentView', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getPanelView', async (payload) => invoke('getPanelView', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getPageState', async (payload) => invoke('getPageState', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.saveProfile', async (payload) => invoke('saveProfile', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.setEnabled', async (payload) => invoke('setEnabled', payload))
  register(
    INTELLIGENCE_PRODUCT_ID,
    'intelligenceSources.testCredentials',
    async (payload) => invoke('testCredentials', payload)
  )
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.runNow', async (payload) => invoke('runNow', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.replayWindow', async (payload) => invoke('replayWindow', payload))
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getHealth', async (payload) => invoke('getHealth', payload))
  register(
    INTELLIGENCE_PRODUCT_ID,
    'intelligenceSources.testConnection',
    async (payload) => invoke('testConnection', payload)
  )
  register(INTELLIGENCE_PRODUCT_ID, 'intelligenceSources.getFocusSettings', async () => invoke('getFocusSettings'))
  register(
    INTELLIGENCE_PRODUCT_ID,
    'intelligenceSources.saveFocusSettings',
    async (payload) => invoke('saveFocusSettings', payload)
  )
}

export { resetIntelligenceModuleForTests } from '../intelligenceModule'
