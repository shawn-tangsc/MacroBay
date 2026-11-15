import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceModule } from '../intelligenceModule'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { getIntelligenceModule, INTELLIGENCE_PRODUCT_ID } from '../intelligenceModule'

/**
 * 读者改完开关后要**立刻**对账调度（2026-11-16，Chief 拍板）。
 *
 * 不接这条，读者在设置里打开三路日历之后要等到下次重启才可能有数据，而他不会知道要重启——
 * 表现就是「开关打开了、什么都没有」，和 11-12 那次停摆一模一样。
 * 对账失败只 `warn`，**不许让保存失败**：保存成功与作业注册是两件事。
 */
export type IntelligenceSourcesIpcHooks = Readonly<{
  onProfilesChanged?: () => void | Promise<void>
}>

export function registerIntelligenceSourcesIpc(
  register: ProductIpcRegistrar,
  jobRuntime: JobRuntime,
  intelligenceModule: IntelligenceModule,
  hooks?: IntelligenceSourcesIpcHooks
): void {
  /** 写档之后跑一次对账；失败只记日志。 */
  const afterWrite = async <T>(result: T): Promise<T> => {
    try {
      await hooks?.onProfilesChanged?.()
    } catch (error) {
      console.warn(`[intelligence-sources] 保存后对账调度失败（已忽略）：${error instanceof Error ? error.message : String(error)}`)
    }
    return result
  }
  const invoke = (method: string, payload?: unknown) => {
    const service = intelligenceModule.sourcesService
    switch (method) {
      case 'listDefinitions':
        return service.listDefinitions()
      case 'listProfiles':
        return service.listProfiles()
      case 'getPageState':
        return service.getPageState((payload ?? {}) as { sourceId?: string })
      case 'saveProfile':
        return service.saveProfile((payload ?? {}) as Parameters<typeof service.saveProfile>[0]).then(afterWrite)
      case 'setEnabled':
        return service.setEnabled((payload ?? {}) as { sourceId: string; enabled: boolean }).then(afterWrite)
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
        return service.setCalendarEnabled((payload ?? {}) as { sourceId: string; enabled: boolean }).then(afterWrite)
      case 'getAgentView':
        return service.getAgentView((payload ?? {}) as { agentId: string })
      case 'getPanelView':
        return service.getPanelView((payload ?? {}) as { panelId: string })
      case 'testConnection':
        return service.testConnection((payload ?? {}) as { sourceId: string })
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
}

export { resetIntelligenceModuleForTests } from '../intelligenceModule'
