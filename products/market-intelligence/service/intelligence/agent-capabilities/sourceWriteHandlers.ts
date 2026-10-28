import { getIntelligenceModule } from '../intelligenceModule'
import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import {
  sourceRequiresCredential,
  type IntelligenceCollectionPreset,
  type IntelligenceFocusMarket,
  type IntelligenceRetentionMode,
  type IntelligenceScopePolicy
} from '../schema/intelligenceSource'
import type {
  SaveIntelligenceFocusMarketSettingsInput,
  SaveIntelligenceSourceProfileInput
} from '../schema/intelligenceSourcesContracts'
import { ProductToolGuardError, type ToolCallContext } from './capabilityTypes'
import type { WriteHandlerDeps } from './writeAudit'
import { runAuditedWrite } from './writeAudit'
import {
  readFocusMarketsSnapshot,
  readRevisionSnapshot,
  readSourceSnapshot
} from './writeState'

const CONFIGURE_CAPABILITY = { id: 'configure_intelligence_source', domain: 'source-config' } as const
const OPERATE_CAPABILITY = { id: 'operate_intelligence_source', domain: 'operations' } as const

type ConfigureSourceInput = {
  action: 'save-profile' | 'set-enabled' | 'save-focus-markets'
  sourceId?: string
  collectionPreset?: IntelligenceCollectionPreset
  includeInSentiment?: boolean
  scopePolicy?: IntelligenceScopePolicy
  rawArchiveEnabled?: boolean
  retentionMode?: IntelligenceRetentionMode
  autoReplayAfterParserUpgrade?: boolean
  monitoredSymbols?: string[]
  enabled?: boolean
  enabledFocusMarkets?: string[]
}

type OperateSourceInput = {
  action: 'run-now' | 'test-connection' | 'retry-assessment'
  sourceId?: string
  itemId?: string
}

export async function handleConfigureIntelligenceSource(
  input: unknown,
  deps: WriteHandlerDeps,
  context: ToolCallContext
): Promise<unknown> {
  const value = input as ConfigureSourceInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService

  if (value.action === 'save-profile') {
    const sourceId = requireString(value.sourceId, 'sourceId')
    const patch = profilePatch(value)
    return runAuditedWrite({
      deps,
      context,
      capability: CONFIGURE_CAPABILITY,
      action: value.action,
      target: sourceId,
      sourceId,
      read: () => readSourceSnapshot(deps, sourceId),
      execute: async () => {
        await sourcesService.saveProfile({ sourceId, ...patch })
        return { state: 'saved', sourceId }
      }
    })
  }

  if (value.action === 'set-enabled') {
    const sourceId = requireString(value.sourceId, 'sourceId')
    if (typeof value.enabled !== 'boolean') {
      throw new ProductToolGuardError('missing-property', 'Missing required parameter: enabled.')
    }
    const enabled = value.enabled
    return runAuditedWrite({
      deps,
      context,
      capability: CONFIGURE_CAPABILITY,
      action: value.action,
      target: sourceId,
      sourceId,
      read: () => readSourceSnapshot(deps, sourceId),
      execute: async () => {
        await sourcesService.setEnabled({ sourceId, enabled })
        return { state: 'saved', sourceId, enabled }
      }
    })
  }

  const enabledFocusMarkets = requireStringArray(value.enabledFocusMarkets, 'enabledFocusMarkets') as IntelligenceFocusMarket[]
  const focusInput: SaveIntelligenceFocusMarketSettingsInput = { enabledFocusMarkets }
  return runAuditedWrite({
    deps,
    context,
    capability: CONFIGURE_CAPABILITY,
    action: value.action,
    read: () => readFocusMarketsSnapshot(deps),
    execute: async () => {
      await sourcesService.saveFocusSettings(focusInput)
      return { state: 'saved', enabledFocusMarkets }
    }
  })
}

export async function handleOperateIntelligenceSource(
  input: unknown,
  deps: WriteHandlerDeps,
  context: ToolCallContext
): Promise<unknown> {
  const value = input as OperateSourceInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService

  if (value.action === 'retry-assessment') {
    const itemId = requireString(value.itemId, 'itemId')
    return runAuditedWrite({
      deps,
      context,
      capability: OPERATE_CAPABILITY,
      action: value.action,
      target: itemId,
      changesConfiguration: false,
      read: () => readRevisionSnapshot(deps),
      execute: async () => {
        const result = await getIntelligenceService(deps.jobRuntime).retryItemAssessment({ itemId })
        return { itemId, ...result }
      }
    })
  }

  const sourceId = requireString(value.sourceId, 'sourceId')
  return runAuditedWrite({
    deps,
    context,
    capability: OPERATE_CAPABILITY,
    action: value.action,
    target: sourceId,
    sourceId,
    changesConfiguration: false,
    read: () => readRevisionSnapshot(deps),
    execute: async () => {
      if (value.action === 'run-now') {
        return { ...(await sourcesService.runNow({ sourceId })) }
      }
      return { ...(await sourcesService.testConnection({ sourceId })) }
    }
  })
}

/**
 * The credential handoff (design 152 §5): a settings entry point and field
 * names. Never a value, never a mask, never a history row.
 */
export async function handleRequestSourceCredential(
  input: unknown,
  deps: WriteHandlerDeps
): Promise<unknown> {
  const sourceId = requireString((input as { sourceId?: string }).sourceId, 'sourceId')
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const definition = sourcesService
    .listDefinitions()
    .find((candidate) => candidate.sourceId === sourceId)
  if (!definition) {
    throw new ProductToolGuardError('handler-error', 'Source is not available.')
  }
  return {
    handoff: 'credential-entry',
    sourceId,
    settingsSectionId: 'intelligence-sources',
    fields: sourceRequiresCredential(definition.authMode) ? ['apiKey'] : []
  }
}

function profilePatch(value: ConfigureSourceInput): Partial<SaveIntelligenceSourceProfileInput> {
  const patch: Partial<SaveIntelligenceSourceProfileInput> = {}
  if (value.collectionPreset !== undefined) patch.collectionPreset = value.collectionPreset
  if (value.includeInSentiment !== undefined) patch.includeInSentiment = value.includeInSentiment
  if (value.scopePolicy !== undefined) patch.scopePolicy = value.scopePolicy
  if (value.rawArchiveEnabled !== undefined) patch.rawArchiveEnabled = value.rawArchiveEnabled
  if (value.retentionMode !== undefined) patch.retentionMode = value.retentionMode
  if (value.autoReplayAfterParserUpgrade !== undefined) {
    patch.autoReplayAfterParserUpgrade = value.autoReplayAfterParserUpgrade
  }
  if (value.monitoredSymbols !== undefined) patch.monitoredSymbols = [...value.monitoredSymbols]
  return patch
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProductToolGuardError('missing-property', `Missing required parameter: ${name}.`)
  }
  return value
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProductToolGuardError('missing-property', `Missing required parameter: ${name}.`)
  }
  return value.filter((item): item is string => typeof item === 'string')
}
