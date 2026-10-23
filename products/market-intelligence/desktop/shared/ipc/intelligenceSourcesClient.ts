import type {
  SafeCredentialProviderConnectionResult,
  SafeCredentialSaveResult,
  SafeCredentialTestResult,
  SafeIntelligenceSourceDetailView,
  SafeIntelligenceSourcesPageState,
  SaveIntelligenceFocusMarketSettingsInput,
  SaveIntelligenceSourceProfileInput
} from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import type { IntelligenceFocusMarketSettings } from '../../../service/intelligence/application/intelligenceFocusSettings'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { AgentView, PanelView, SettingsView } from '../../../service/intelligence/application/sourceProjection'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceSourcesClientErrorCode =
  | 'bridge-missing'
  | 'request-failed'
  | 'invalid-response'

export class IntelligenceSourcesClientError extends Error {
  constructor(
    readonly code: IntelligenceSourcesClientErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'IntelligenceSourcesClientError'
  }
}

function invoke<T>(method: string, payload?: unknown): Promise<T> {
  if (!window.platform?.products?.invoke) {
    // Return a rejected promise instead of throwing synchronously: every caller attaches
    // `.catch()` to this promise, and a synchronous throw bypasses those handlers.
    return Promise.reject(
      new IntelligenceSourcesClientError('bridge-missing', 'Product IPC bridge is unavailable.')
    )
  }

  return window.platform.products.invoke(PRODUCT_ID, method, payload).catch((error: unknown) => {
    throw new IntelligenceSourcesClientError(
      'request-failed',
      error instanceof Error ? error.message : 'Intelligence sources request failed.'
    )
  }) as Promise<T>
}

export const intelligenceSourcesClient = {
  listDefinitions() {
    return invoke<SafeIntelligenceSourcesPageState['definitions']>('intelligenceSources.listDefinitions')
  },
  listProfiles() {
    return invoke<IntelligenceSourceProfile[]>('intelligenceSources.listProfiles')
  },
  getSettingsView() {
    return invoke<SettingsView>('intelligenceSources.getSettingsView')
  },
  getAgentView(agentId: string) {
    return invoke<AgentView | undefined>('intelligenceSources.getAgentView', { agentId })
  },
  getPanelView(panelId: string) {
    return invoke<PanelView | undefined>('intelligenceSources.getPanelView', { panelId })
  },
  revealCredential(sourceId: string) {
    return invoke<{ apiKey: string | null }>('intelligenceSources.revealCredential', { sourceId })
  },
  setCalendarEnabled(sourceId: string, enabled: boolean) {
    return invoke<{ ok: boolean; failureCode?: string }>('intelligenceSources.setCalendarEnabled', { sourceId, enabled })
  },
  getPageState(sourceId?: string) {
    return invoke<SafeIntelligenceSourcesPageState>('intelligenceSources.getPageState', sourceId ? { sourceId } : {})
  },
  saveProfile(input: SaveIntelligenceSourceProfileInput) {
    return invoke<SafeIntelligenceSourceDetailView>('intelligenceSources.saveProfile', input)
  },
  setEnabled(sourceId: string, enabled: boolean) {
    return invoke<SafeIntelligenceSourceDetailView>('intelligenceSources.setEnabled', { sourceId, enabled })
  },
  testCredentials(input: { sourceId: string; credentialDraft?: string }) {
    return invoke<SafeCredentialTestResult | SafeCredentialSaveResult>('intelligenceSources.testCredentials', input)
  },
  runNow(sourceId: string) {
    return invoke<{ action: string }>('intelligenceSources.runNow', { sourceId })
  },
  replayWindow(input: { sourceId: string; from?: string; to?: string }) {
    return invoke<{ summary: string }>('intelligenceSources.replayWindow', input)
  },
  getHealth(sourceId: string) {
    return invoke<SafeIntelligenceSourceDetailView['health']>('intelligenceSources.getHealth', { sourceId })
  },
  testConnection(sourceId: string) {
    return invoke<{ ok: boolean; message: string; testedAt: string } | SafeCredentialProviderConnectionResult>('intelligenceSources.testConnection', { sourceId })
  },
  getFocusSettings() {
    return invoke<IntelligenceFocusMarketSettings>('intelligenceSources.getFocusSettings')
  },
  saveFocusSettings(input: SaveIntelligenceFocusMarketSettingsInput) {
    return invoke<IntelligenceFocusMarketSettings>('intelligenceSources.saveFocusSettings', input)
  }
}
