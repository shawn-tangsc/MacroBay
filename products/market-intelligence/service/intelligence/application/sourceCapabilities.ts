import { getProvider, type SourceDefinition } from './providerRegistry'

export type SourceCapabilityView = {
  canEnable: boolean
  canRunNow: boolean
  runNowKind: SourceDefinition['capabilities']['runNow']
  canTestConnection: boolean
  canSyncBls: boolean
  canEditCredentials: boolean
}

export function resolveSourceCapabilities(source: SourceDefinition): SourceCapabilityView {
  const provider = getProvider(source.providerId)
  const blocked = source.visibility === 'pending' || source.collection === 'none'
  return {
    canEnable: !blocked,
    canRunNow: !blocked && source.capabilities.runNow !== 'none',
    runNowKind: source.capabilities.runNow,
    canTestConnection: !blocked && source.capabilities.testConnection,
    canSyncBls: !blocked && source.capabilities.blsSync === true,
    canEditCredentials: provider?.credential === 'api-key'
  }
}
